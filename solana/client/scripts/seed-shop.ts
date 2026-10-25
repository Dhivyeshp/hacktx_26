// Lists the game-night perks in the on-chain shop. Safe to re-run: existing items are skipped.
//   npm run chain:seed-shop
import { ChainClient } from '../src/index.ts'

// kind: 0 = table perk the hub announces, 1 = robot action the hub sends to the Pi.
const ITEMS = [
  { id: 1, name: 'Robot victory spin', price: 5, supply: 0, minLevel: 0, kind: 1 },
  { id: 2, name: 'Skip the Hot Seat', price: 8, supply: 0, minLevel: 0, kind: 0 },
  { id: 3, name: 'Choose the next challenge', price: 10, supply: 0, minLevel: 0, kind: 0 },
  { id: 4, name: 'Your name on the robot face', price: 12, supply: 0, minLevel: 2, kind: 1 },
  { id: 5, name: 'Golden capsule ticket', price: 40, supply: 3, minLevel: 3, kind: 0 },
]

const chain = ChainClient.fromEnv()
for (const item of ITEMS) {
  if (await chain.connection.getAccountInfo(chain.pda.item(item.id))) {
    console.log(`exists   #${item.id} ${item.name}`)
    continue
  }
  const { signature } = await chain.createItem(item)
  console.log(`listed   #${item.id} ${item.name} (${item.price} TABLE)  ${chain.explorer(signature)}`)
}
console.table(await chain.items())

// The RPC websocket keeps the event loop alive.
process.exit(0)
