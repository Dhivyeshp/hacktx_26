// One-time setup after deploying: creates the Config account and the TABLE coin.
//   SOLANA_CLUSTER=devnet CHAIN_PUBLIC_URL=https://<chain-service> npm run chain:init
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { ChainClient } from '../src/index.ts'

const chain = ChainClient.fromEnv()
const balance = await chain.connection.getBalance(chain.admin.publicKey)
console.log(`program   ${chain.programId.toBase58()} (${chain.cluster})`)
console.log(`admin     ${chain.admin.publicKey.toBase58()}  ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL`)

const existing = await chain.getConfig()
if (existing) {
  console.log(`already initialized; coin mint ${existing.coinMint.toBase58()}`)
} else {
  const sig = await chain.initialize({
    maxAwardPerRound: Number(process.env.MAX_AWARD_PER_ROUND ?? 100),
    maxKudos: Number(process.env.MAX_KUDOS ?? 10),
  })
  console.log(`initialized: ${chain.explorer(sig)}`)
}
console.log(`coin mint ${chain.pda.coinMint.toBase58()}  ${chain.explorer(chain.pda.coinMint.toBase58(), 'address')}`)
console.log(`metadata  ${chain.metadataBaseUrl}/meta/coin.json`)

// The RPC websocket keeps the event loop alive.
process.exit(0)
