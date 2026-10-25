// Run with `npm run chain:test` (starts solana-test-validator with the program, then runs this file).
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
  getPermanentDelegate,
  transferChecked,
} from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { CenterpieceReader, ChainClient, decodeAchievements, subscribeEvents, type ChainEvent } from '../client/src/index.ts'

const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? 'http://127.0.0.1:8899', 'confirmed')
const adminPath = (process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json').replace(/^~/, homedir())
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(adminPath, 'utf8'))))
const opts = { connection, metadataBaseUrl: 'http://localhost:8787', cluster: 'localnet' }
const chain = new ChainClient({ ...opts, admin })

const MAX_AWARD = 100
const MAX_KUDOS = 10
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

/** A registered player holding `coins` TABLE (paid as one round of a throwaway session). */
async function playerWith(coins: number, connections = 0) {
  const kp = Keypair.generate()
  await chain.registerPlayer(kp.publicKey)
  if (coins > 0)
    await chain.settleRound({
      sessionId: randomUUID(),
      roundNo: 1,
      eventsHash: randomHash(),
      awards: [{ wallet: kp.publicKey, points: coins, connections }],
    })
  return kp
}

const maya = Keypair.generate()
const jordan = Keypair.generate()

before(async () => {
  if (!(await chain.getConfig())) await chain.initialize({ maxAwardPerRound: MAX_AWARD, maxKudos: MAX_KUDOS })
  await chain.registerPlayer(maya.publicKey)
  await chain.registerPlayer(jordan.publicKey)
})

// ---------- core (v1 behaviour, carried into v2) ----------

test('coin mint is controlled by the program PDA, including a permanent delegate', async () => {
  const mint = await getMint(connection, chain.pda.coinMint, 'confirmed', TOKEN_2022_PROGRAM_ID)
  assert.equal(mint.decimals, 0)
  assert.ok(mint.mintAuthority?.equals(chain.pda.mintAuth))
  assert.ok(getPermanentDelegate(mint)?.delegate.equals(chain.pda.mintAuth))
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
  assert.deepEqual(meta?.fields, { level: '1', xp: '0', connections: '0', kudos: '0', achievements: '0' })
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
  // first round + first connection unlocked automatically
  assert.deepEqual(profile?.achievements, ['first_round', 'first_connection'])
  assert.deepEqual(profile?.badgeFields, { level: '2', xp: '12', connections: '2', kudos: '0', achievements: '2' })

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
  assert.equal((await chain.getPlayer(jordan.publicKey))?.keepsakes, 1)
  const held = await chain.keepsakes(jordan.publicKey)
  assert.deepEqual(held.map((k) => k.mint), [mint.toBase58()])
})

// ---------- kudos ----------

test('kudos move TABLE, connect the pair, and update both profiles', async () => {
  const a = await playerWith(20)
  const b = await playerWith(0)
  await chain.giveKudos(a.publicKey, b.publicKey, 5)

  assert.equal(await chain.coinBalance(a.publicKey), 15)
  assert.equal(await chain.coinBalance(b.publicKey), 5)
  const [pa, pb] = await Promise.all([chain.profile(a.publicKey), chain.profile(b.publicKey)])
  assert.equal(pa?.kudosGiven, 1)
  assert.equal(pb?.kudosReceived, 1)
  assert.equal(pa?.connections, 1, 'first kudos between two people is a new connection')
  assert.equal(pb?.connections, 1)
  assert.equal(pb?.badgeFields.kudos, '1')
  assert.ok(pb?.achievements.includes('first_connection'))

  const link = await chain.program.account.kudosLink.fetch(chain.pda.kudosLink(a.publicKey, b.publicKey))
  assert.equal(link.count, 1)
  assert.equal(Number(link.total.toString()), 5)

  await rejects(chain.giveKudos(a.publicKey, b.publicKey, 1), /KudosCooldown/)
  await rejects(chain.giveKudos(b.publicKey, a.publicKey, MAX_KUDOS + 1), /KudosTooLarge/)
  await rejects(chain.giveKudos(a.publicKey, a.publicKey, 1), /SelfKudos|ConstraintMut|Duplicate|already in use/i)
})

test('a wallet can sign its own kudos; anyone else is rejected', async () => {
  const sender = await playerWith(10)
  const receiver = await playerWith(0)
  await airdrop(sender)

  const reader = new CenterpieceReader(connection)
  const tx = await reader.buildGiveKudosTx(sender.publicKey, receiver.publicKey, 3)
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(sender)
  const sig = await connection.sendRawTransaction(tx.serialize())
  await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) })
  assert.equal(await chain.coinBalance(receiver.publicKey), 3)

  const stranger = Keypair.generate()
  await airdrop(stranger)
  const rogue = new ChainClient({ ...opts, admin: stranger })
  await rejects(rogue.giveKudos(sender.publicKey, receiver.publicKey, 1), /Unauthorized/)
})

// ---------- shop ----------

test('shop: redeeming burns TABLE, counts stock, and writes receipts', async () => {
  await chain.createItem({ id: 1, name: 'Robot victory spin', price: 5, supply: 2, kind: 1 })
  await chain.createItem({ id: 2, name: 'Skip the Hot Seat', price: 8 })
  await chain.createItem({ id: 3, name: 'Golden capsule ticket', price: 40, supply: 3, minLevel: 5 })
  const buyer = await playerWith(30)
  const supplyBefore = (await getMint(connection, chain.pda.coinMint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply

  const first = await chain.redeemItem(buyer.publicKey, 1)
  assert.equal(first.number, 0)
  await chain.redeemItem(buyer.publicKey, 1)
  assert.equal(await chain.coinBalance(buyer.publicKey), 20)
  const supplyAfter = (await getMint(connection, chain.pda.coinMint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply
  assert.equal(supplyBefore - supplyAfter, 10n, 'price is burned, not transferred')

  await rejects(chain.redeemItem(buyer.publicKey, 1), /SoldOut/)
  await rejects(chain.redeemItem(buyer.publicKey, 3), /LevelTooLow/)
  await chain.updateItem(2, { price: 8, supply: 0, minLevel: 0, active: false })
  await rejects(chain.redeemItem(buyer.publicKey, 2), /ItemInactive/)

  const items = await chain.items()
  assert.equal(items.find((i) => i.id === 1)?.remaining, 0)
  const receipts = await chain.receipts(buyer.publicKey)
  assert.deepEqual(receipts.map((r) => [r.itemId, r.number, r.fulfilled]), [[1, 1, false], [1, 0, false]])
  assert.ok(receipts.every((r) => r.price === 5))

  await chain.fulfillReceipt(first.receipt)
  assert.equal((await chain.receipts(buyer.publicKey)).find((r) => r.number === 0)?.fulfilled, true)
  assert.ok((await chain.profile(buyer.publicKey))?.achievements.includes('shopper'))
})

test('shop: only the admin can list items', async () => {
  const stranger = Keypair.generate()
  await airdrop(stranger)
  const rogue = new ChainClient({ ...opts, admin: stranger })
  await rejects(rogue.createItem({ id: 99, name: 'Free coins', price: 0 }), /has.one|ConstraintHasOne|2001/i)
})

// ---------- achievements ----------

test('achievements: server-granted bits need the admin and bit >= 16', async () => {
  const p = await playerWith(5, 1)
  await chain.grantAchievement(p.publicKey, 16)
  const profile = await chain.profile(p.publicKey)
  assert.deepEqual(profile?.achievements, ['first_round', 'first_connection', 'quiet_hero'])
  assert.equal(profile?.badgeFields.achievements, '3')
  assert.deepEqual(decodeAchievements(profile!.achievementMask).map((a) => a.emoji), ['🎲', '🧊', '🦸'])

  await rejects(chain.grantAchievement(p.publicKey, 3), /ReservedAchievement/)
  const stranger = Keypair.generate()
  await airdrop(stranger)
  await rejects(new ChainClient({ ...opts, admin: stranger }).grantAchievement(p.publicKey, 17), /has.one|ConstraintHasOne|2001/i)
})

// ---------- table goal ----------

test('table goal: awards fill the pot, and everyone who played claims the bonus once', async () => {
  const sessionId = randomUUID()
  await chain.openSession({ sessionId, goal: 30, bonusPerPlayer: 7 })
  const [p1, p2, outsider] = await Promise.all([playerWith(0), playerWith(0), playerWith(0)])

  await rejects(chain.claimTableBonus(sessionId, p1.publicKey), /NotInSession/)
  const r1 = await chain.settleRound({
    sessionId,
    roundNo: 1,
    eventsHash: randomHash(),
    awards: [{ wallet: p1.publicKey, points: 12 }, { wallet: p2.publicKey, points: 8 }],
  })
  assert.equal(r1.tableGoal?.pot, 20)
  assert.equal(r1.tableGoal?.reached, false)
  await rejects(chain.claimTableBonus(sessionId, p1.publicKey), /GoalNotReached/)

  const r2 = await chain.settleRound({
    sessionId,
    roundNo: 2,
    eventsHash: randomHash(),
    awards: [{ wallet: p2.publicKey, points: 15 }],
  })
  assert.equal(r2.tableGoal?.pot, 35)
  assert.equal(r2.tableGoal?.reached, true)

  await chain.claimTableBonus(sessionId, p1.publicKey)
  await chain.claimTableBonus(sessionId, p2.publicKey)
  assert.equal(await chain.coinBalance(p1.publicKey), 12 + 7)
  assert.equal(await chain.coinBalance(p2.publicKey), 23 + 7)
  assert.ok((await chain.profile(p1.publicKey))?.achievements.includes('team_player'))
  assert.equal((await chain.session(sessionId))?.bonusesClaimed, 2)

  await rejects(chain.claimTableBonus(sessionId, p1.publicKey), /already in use/)
  await rejects(chain.claimTableBonus(sessionId, outsider.publicKey), /NotInSession/)
})

// ---------- reads and events ----------

test('leaderboard ranks players and the event stream reports kudos live', async () => {
  const board = await chain.leaderboard('xp', 5)
  assert.ok(board.length > 0)
  assert.ok(board.every((p, i) => i === 0 || board[i - 1].xp >= p.xp))
  assert.equal(board[0].rank, 1)

  const a = await playerWith(10)
  const b = await playerWith(0)
  const seen: ChainEvent[] = []
  const unsubscribe = subscribeEvents(connection, (e) => seen.push(e))
  await new Promise((r) => setTimeout(r, 500))
  await chain.giveKudos(a.publicKey, b.publicKey, 2)
  const deadline = Date.now() + 15_000
  while (!seen.some((e) => e.name === 'KudosGiven') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
  await unsubscribe()
  const kudos = seen.find((e) => e.name === 'KudosGiven')
  assert.ok(kudos, `no KudosGiven event; saw ${seen.map((e) => e.name).join(', ')}`)
  assert.equal(kudos!.data.from, a.publicKey.toBase58())
  assert.equal(kudos!.data.amount, 2)
})

