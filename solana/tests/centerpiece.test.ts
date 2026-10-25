// Run with `anchor test` (starts a local validator, deploys, then runs this file).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMint,
  transferChecked,
} from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { ChainClient } from '../client/src/index.ts'

const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? 'http://127.0.0.1:8899', 'confirmed')
const adminPath = (process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json').replace(/^~/, homedir())
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(adminPath, 'utf8'))))
const opts = { connection, metadataBaseUrl: 'http://localhost:8787', cluster: 'localnet' }
const chain = new ChainClient({ ...opts, admin })

const MAX_AWARD = 100
const randomHash = () => Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)))

async function airdrop(kp: Keypair, sol = 2) {
  const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL)
  await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) })
}

async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (err: any) => {
    const text = `${err.message}\n${(err.logs ?? err.transactionLogs ?? []).join('\n')}`
    assert.match(text, pattern)
    return true
  })
}

const maya = Keypair.generate()
const jordan = Keypair.generate()

before(async () => {
  if (!(await chain.getConfig())) await chain.initialize({ maxAwardPerRound: MAX_AWARD })
  await chain.registerPlayer(maya.publicKey)
  await chain.registerPlayer(jordan.publicKey)
})

test('coin mint is controlled by the program PDA', async () => {
  const mint = await getMint(connection, chain.pda.coinMint, 'confirmed', TOKEN_2022_PROGRAM_ID)
  assert.equal(mint.decimals, 0)
  assert.ok(mint.mintAuthority?.equals(chain.pda.mintAuth))
  const meta = await chain.tokenMetadata(chain.pda.coinMint)
  assert.equal(meta?.symbol, 'TABLE')
  assert.equal(meta?.uri, 'http://localhost:8787/meta/coin.json')
})

test('player badge is a soulbound 1-of-1 with live fields', async () => {
  const badge = chain.pda.badge(maya.publicKey)
  const mint = await getMint(connection, badge, 'confirmed', TOKEN_2022_PROGRAM_ID)
  assert.equal(mint.supply, 1n)
  assert.equal(mint.mintAuthority, null)
  assert.ok(getExtensionTypes(mint.tlvData).includes(ExtensionType.NonTransferable))
  const meta = await chain.tokenMetadata(badge)
  assert.deepEqual(meta?.fields, { level: '1', xp: '0', connections: '0' })
})

test('badge cannot be transferred', async () => {
  const badge = chain.pda.badge(maya.publicKey)
  const from = getAssociatedTokenAddressSync(badge, maya.publicKey, false, TOKEN_2022_PROGRAM_ID)
  const to = await createAssociatedTokenAccountIdempotent(
    connection, admin, badge, jordan.publicKey, undefined, TOKEN_2022_PROGRAM_ID,
  )
  await rejects(
    transferChecked(connection, admin, from, badge, to, maya, 1, 0, [], undefined, TOKEN_2022_PROGRAM_ID),
    /non-transferable|0x25|NonTransferable/i,
  )
})

test('a round pays each player once, mints coin, and levels up the badge', async () => {
  const sessionId = randomUUID()
  const awards = [
    { wallet: maya.publicKey, points: 12, connections: 2 },
    { wallet: jordan.publicKey, points: 5, connections: 1 },
  ]
  const res = await chain.settleRound({ sessionId, roundNo: 1, eventsHash: randomHash(), awards })
  assert.ok(res.attestSignature)
  assert.ok(res.awards.every((a) => a.signature), JSON.stringify(res.awards))

  assert.equal(await chain.coinBalance(maya.publicKey), 12)
  const profile = await chain.profile(maya.publicKey)
  assert.equal(profile?.level, 2)
  assert.deepEqual(profile?.badgeFields, { level: '2', xp: '12', connections: '2' })

  // Retrying the settlement is a no-op, not a double payout.
  const again = await chain.settleRound({ sessionId, roundNo: 1, eventsHash: randomHash(), awards })
  assert.equal(again.attestSignature, null)
  assert.ok(again.awards.every((a) => a.skipped === 'already paid'))
  assert.equal(await chain.coinBalance(maya.publicKey), 12)

  // Calling award_player directly for the same round fails on the receipt PDA.
  await rejects(chain.awardPlayer({ sessionId, roundNo: 1, wallet: maya.publicKey, points: 1 }), /already in use/)
})

test('a round cannot be attested twice', async () => {
  const sessionId = randomUUID()
  await chain.attestRound({ sessionId, roundNo: 1, eventsHash: randomHash(), playerCount: 2 })
  await rejects(
    chain.attestRound({ sessionId, roundNo: 1, eventsHash: randomHash(), playerCount: 2 }),
    /already in use/,
  )
  const round = await chain.getRound(sessionId, 1)
  assert.equal(round?.playerCount, 2)
})

test('awards are capped and limited to the attested player count', async () => {
  const sessionId = randomUUID()
  await chain.attestRound({ sessionId, roundNo: 1, eventsHash: randomHash(), playerCount: 1 })
  await rejects(
    chain.awardPlayer({ sessionId, roundNo: 1, wallet: maya.publicKey, points: MAX_AWARD + 1 }),
    /AwardTooLarge/,
  )
  await chain.awardPlayer({ sessionId, roundNo: 1, wallet: maya.publicKey, points: 1 })
  await rejects(
    chain.awardPlayer({ sessionId, roundNo: 1, wallet: jordan.publicKey, points: 1 }),
    /RoundFullyAwarded/,
  )
})

test('only the admin can settle rounds', async () => {
  const intruder = Keypair.generate()
  await airdrop(intruder)
  const rogue = new ChainClient({ ...opts, admin: intruder })
  await rejects(
    rogue.attestRound({ sessionId: randomUUID(), roundNo: 1, eventsHash: randomHash(), playerCount: 1 }),
    /has.one|ConstraintHasOne|2001/i,
  )
})

test('keepsakes are transferable 1-of-1 NFTs with on-chain fields', async () => {
  const sessionId = randomUUID()
  await chain.attestRound({ sessionId, roundNo: 3, eventsHash: randomHash(), playerCount: 2 })
  const before = Number((await chain.getConfig())!.keepsakeCount.toString())
  const { mint } = await chain.mintKeepsake({
    sessionId,
    roundNo: 3,
    wallet: jordan.publicKey,
    name: 'Forge: The Pocket Volcano',
    image: 'https://example.com/forge.png',
    challenge: 'forge',
  })
  const m = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
  assert.equal(m.supply, 1n)
  assert.equal(m.mintAuthority, null)
  assert.ok(!getExtensionTypes(m.tlvData).includes(ExtensionType.NonTransferable))
  const meta = await chain.tokenMetadata(mint)
  assert.equal(meta?.name, 'Forge: The Pocket Volcano')
  assert.equal(meta?.fields.challenge, 'forge')
  assert.equal(meta?.fields.round, '3')
  assert.equal(meta?.fields.image, 'https://example.com/forge.png')
  assert.equal(meta?.uri, `http://localhost:8787/meta/keepsake/${mint.toBase58()}.json`)
  assert.equal(Number((await chain.getConfig())!.keepsakeCount.toString()), before + 1)
})
