// End-to-end check against the configured cluster: registers two throwaway
// players, settles a round, mints a keepsake, and prints explorer links.
//   npm run chain:smoke
import { randomBytes, randomUUID } from 'node:crypto'
import { ChainClient } from '../src/index.ts'

const chain = ChainClient.fromEnv()
if (!(await chain.getConfig())) throw new Error('program not initialized; run npm run chain:init first')

const a = chain.createCustodialWallet()
const b = chain.createCustodialWallet()
for (const w of [a, b]) {
  const { signature, badgeMint } = await chain.registerPlayer(w.publicKey)
  console.log(`registered ${w.publicKey.toBase58()}  badge ${badgeMint.toBase58()}\n  ${chain.explorer(signature)}`)
}

const sessionId = randomUUID()
const settled = await chain.settleRound({
  sessionId,
  roundNo: 1,
  eventsHash: randomBytes(32),
  awards: [
    { wallet: a.publicKey, points: 14, connections: 2 },
    { wallet: b.publicKey, points: 6, connections: 1 },
  ],
})
console.log(`\nround ${settled.round}\n  attest ${chain.explorer(settled.attestSignature!)}`)
for (const r of settled.awards) console.log(`  award ${r.points} -> ${r.wallet}  ${r.signature ? chain.explorer(r.signature) : r.error}`)

const { mint, signature } = await chain.mintKeepsake({
  sessionId,
  roundNo: 1,
  wallet: a.publicKey,
  name: 'Smoke Test Keepsake',
  image: `${chain.metadataBaseUrl}/img/coin.svg`,
  challenge: 'forge',
})
console.log(`\nkeepsake ${mint.toBase58()}\n  ${chain.explorer(signature)}`)
console.log('\nprofile', await chain.profile(a.publicKey))

// The RPC websocket keeps the event loop alive.
process.exit(0)
