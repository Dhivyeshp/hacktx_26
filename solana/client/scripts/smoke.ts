// End-to-end check against the configured cluster: registers two throwaway
// players, opens a session with a table goal, settles a round, sends kudos,
// redeems a shop perk, claims the table bonus, grants an achievement, mints a
// keepsake, and prints explorer links.
//   npm run chain:smoke   (after chain:init and chain:seed-shop)
import { randomBytes, randomUUID } from 'node:crypto'
import { ChainClient } from '../src/index.ts'

const chain = ChainClient.fromEnv()
if (!(await chain.getConfig())) throw new Error('program not initialized; run npm run chain:init first')
const link = (label: string, sig: string) => console.log(`  ${label.padEnd(10)} ${chain.explorer(sig)}`)

const a = chain.createCustodialWallet()
const b = chain.createCustodialWallet()
for (const w of [a, b]) {
  const { signature, badgeMint } = await chain.registerPlayer(w.publicKey)
  console.log(`registered ${w.publicKey.toBase58()}  badge ${badgeMint.toBase58()}`)
  link('register', signature)
}

const sessionId = randomUUID()
link('session', (await chain.openSession({ sessionId, goal: 20, bonusPerPlayer: 5 })).signature)

const settled = await chain.settleRound({
  sessionId,
  roundNo: 1,
  eventsHash: randomBytes(32),
  awards: [
    { wallet: a.publicKey, points: 14, connections: 2 },
    { wallet: b.publicKey, points: 6, connections: 1 },
  ],
})
console.log(`round ${settled.round}  table goal ${settled.tableGoal?.pot}/${settled.tableGoal?.goal} reached=${settled.tableGoal?.reached}`)
link('attest', settled.attestSignature!)
for (const r of settled.awards) r.signature ? link(`award ${r.points}`, r.signature) : console.log(`  award failed: ${r.error}`)

link('kudos', (await chain.giveKudos(a.publicKey, b.publicKey, 3)).signature)
if (await chain.connection.getAccountInfo(chain.pda.item(1))) link('redeem', (await chain.redeemItem(a.publicKey, 1)).signature)
else console.log('  (shop empty; run npm run chain:seed-shop)')
for (const w of [a, b]) link('bonus', (await chain.claimTableBonus(sessionId, w.publicKey)).signature)
link('achieve', await chain.grantAchievement(b.publicKey, 16))

const { mint, signature } = await chain.mintKeepsake({
  sessionId,
  roundNo: 1,
  wallet: a.publicKey,
  name: 'Smoke Test Keepsake',
  image: `${chain.metadataBaseUrl}/img/coin.svg`,
  challenge: 'forge',
})
console.log(`keepsake ${mint.toBase58()}`)
link('keepsake', signature)

console.log('\nprofile a', await chain.profile(a.publicKey))
console.log('profile b', await chain.profile(b.publicKey))
console.log('session', await chain.session(sessionId))

// The RPC websocket keeps the event loop alive.
process.exit(0)
