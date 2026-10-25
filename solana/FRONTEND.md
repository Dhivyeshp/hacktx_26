# Using the chain from the web app

Everything on Solana is reachable in three ways. Use whichever fits.

| | Best for | Needs |
| --- | --- | --- |
| **REST** at `https://centerpiece-chain.onrender.com` | Pages, leaderboards, profiles, shop | `fetch` only |
| **Live events** at `GET /events` (Server-Sent Events) | Toasts, confetti, "Maya sent Jordan 3 TABLE" | `EventSource` only |
| **`@centerpiece/chain/core`** (TypeScript) | Reading chain data directly, or letting a player sign with Phantom | `@solana/web3.js` plus a Buffer polyfill in Vite |

Machine-readable docs: `GET /openapi.json` (paste the URL into editor.swagger.io) and `GET /idl.json`.

## Who signs what

Players have **custodial wallets** created at check-in (`POST /players`); the hub keeps the key. Every write therefore goes through the hub or this API with the bearer token, **never from the browser**. Put `CHAIN_API_TOKEN` only on your server.

The one exception is a player who connects Phantom: they can sign their own kudos and shop redemptions with `buildGiveKudosTx` and `buildRedeemTx`, shown below.

## Read endpoints (public, CORS open)

| Route | Returns |
| --- | --- |
| `GET /players/:wallet` | Profile (example below) |
| `GET /players/:wallet/keepsakes` | `[{ mint, name, image, challenge, round, number, metadataUri }]` |
| `GET /players/:wallet/receipts` | `[{ address, itemId, price, number, createdAt, fulfilled }]`, newest first |
| `GET /leaderboard?by=xp\|coins\|kudos\|connections&limit=20` | `[{ rank, wallet, level, xp, kudosReceived, connections, achievements, … }]` |
| `GET /shop` | `[{ id, name, price, supply, sold, remaining, minLevel, kind, active }]`; `remaining: null` means unlimited |
| `GET /shop/pending` | Unfulfilled redemptions, oldest first (the hub's to-do list) |
| `GET /sessions/:sessionId` | `{ goal, pot, progress (0..1), reached, reachedAt, bonusPerPlayer, bonusesClaimed }` |
| `GET /achievements` | Catalog: `[{ bit, key, title, description, emoji, source }]` |
| `GET /rounds/:sessionId/:roundNo` | On-chain attestation: `{ eventsHash, playerCount, awardedCount, totalAwarded }` |
| `GET /events/recent?limit=50&name=KudosGiven` | Recent program events, newest first |
| `GET /img/badge/:wallet.svg` | Live badge image (level, xp, connections, kudos, achievement emojis) |

```jsonc
// GET /players/7SkrmjT…
{
  "wallet": "7SkrmjT…", "badgeMint": "C9iLTRv…",
  "level": 3, "xp": 42, "coins": 37, "coinsEarned": 42,
  "connections": 3, "roundsPlayed": 2,
  "kudosGiven": 1, "kudosReceived": 2, "keepsakes": 1, "redemptions": 1,
  "achievements": ["first_round", "first_connection", "level_3", "shopper"],
  "achievementDetails": [{ "bit": 0, "key": "first_round", "title": "First Round", "emoji": "🎲", … }],
  "badgeFields": { "level": "3", "xp": "42", "connections": "3", "kudos": "2", "achievements": "4" }
}
```

## Write endpoints (`Authorization: Bearer $CHAIN_API_TOKEN`, call from your server)

| Route | Body | Notes |
| --- | --- | --- |
| `POST /players` | `{ wallet? }` | Creates a custodial wallet if none is given. Returns `secretKey` once; store it. |
| `POST /kudos` | `{ from, to, amount }` | 1–10 TABLE, 60 s cooldown per pair. The first kudos between two people adds a connection for both. |
| `POST /shop/redeem` | `{ wallet, itemId }` | Burns the price and returns `{ receipt, number }`. |
| `POST /receipts/:address/fulfill` | none | Call once the perk has happened. |
| `POST /sessions` | `{ sessionId, goal, bonusPerPlayer }` | Opens a table goal for a game night. |
| `POST /rounds/settle` | `{ sessionId, roundNo, eventsHash, awards: [{ wallet, points, connections }] }` | Pays a round, fills the table goal, and returns `tableGoal`. |
| `POST /sessions/:id/bonus` | `{ wallets: [] }` | Pays the goal bonus to each wallet that played (once each). |
| `POST /achievements/grant` | `{ wallet, achievement: "quiet_hero" }` | Server-judged achievements only (`source: "granted"`). |
| `POST /keepsakes` | `{ sessionId, roundNo, wallet, name, image, challenge }` | Mints a 1-of-1 keepsake NFT. |
| `POST /shop/items`, `POST /shop/items/:id` | See `/openapi.json` | Admin catalog management. |

Program rule violations come back as **HTTP 400 with a stable code** you can map to UI copy:

```json
{ "error": "KudosCooldown", "message": "Wait a minute before sending this person kudos again" }
```

| Code | Meaning |
| --- | --- |
| `KudosCooldown` | Same sender and receiver within 60 s |
| `KudosTooLarge` | Amount is 0 or over the max |
| `SelfKudos` | Sender and receiver are the same |
| `SoldOut` | The item has no stock left |
| `ItemInactive` | The item has been pulled from sale |
| `LevelTooLow` | The player's level is under the item's minimum |
| `GoalNotReached` | The table goal isn't met yet |
| `NotInSession` | The wallet wasn't paid in this session |
| `AwardTooLarge` | The award is over the per-round cap |
| `RoundFullyAwarded` | Every attested player has been paid |
| `Unauthorized` | The signer isn't the admin or the wallet |

If the sender has too few coins, the error is a token-program failure (HTTP 500 with `logs`).

## Live events

```js
const es = new EventSource('https://centerpiece-chain.onrender.com/events?replay=20')
es.addEventListener('KudosGiven', (e) => {
  const { data } = JSON.parse(e.data) // { from, to, amount, firstTime, kudosReceived }
  toast(`${short(data.from)} sent ${short(data.to)} ${data.amount} TABLE`)
})
es.addEventListener('TableGoalReached', (e) => confetti())
```

| Event | `data` fields | Good UI moment |
| --- | --- | --- |
| `Awarded` | `wallet, round, points, xp, level, leveledUp` | Coins fly in; level-up banner |
| `KudosGiven` | `from, to, amount, firstTime, kudosReceived` | Toast; "new connection!" when `firstTime` |
| `AchievementUnlocked` | `wallet, unlocked (bitmask), achievements` | Badge pop with emoji: decode with `/achievements` |
| `TableGoalReached` | `session, sessionId, goal, pot` | Whole-table celebration |
| `TableBonusClaimed` | `session, wallet, amount` | |
| `ItemRedeemed` | `wallet, itemId, kind, price, receipt, number` | `kind 1` = a robot action is coming |
| `ReceiptFulfilled` | `receipt, wallet, itemId` | |
| `KeepsakeMinted` | `wallet, mint, round, number` | Show the keepsake card |
| `PlayerRegistered`, `RoundAttested`, `SessionOpened`, `ItemListed` | | |

Each event is `{ name, data, signature, slot }`, and `signature` links to `https://explorer.solana.com/tx/<signature>?cluster=devnet`. The same events go to the websocket relay as `{ "type": "chain_event", … }` when the chain service has `RELAY_URL`/`RELAY_TOKEN` set, so the Vision Pro and dashboards get them too.

## TypeScript: read directly or sign with Phantom

```ts
import { Connection } from '@solana/web3.js'
import { CenterpieceReader, decodeAchievements, subscribeEvents } from '@centerpiece/chain/core'

const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const chain = new CenterpieceReader(connection)

await chain.profile(wallet)          // same shape as GET /players/:wallet
await chain.leaderboard('kudos', 10)
await chain.items()
await chain.session(sessionId)
const stop = subscribeEvents(connection, (e) => console.log(e.name, e.data))

// Self-custody kudos (player connected Phantom via @solana/wallet-adapter)
const tx = await chain.buildGiveKudosTx(publicKey, friendWallet, 3)
const sig = await sendTransaction(tx, connection) // wallet adapter's sendTransaction
```

Vite needs `buffer` for web3.js: `npm i buffer`, then `globalThis.Buffer ??= (await import('buffer')).Buffer` in `main.ts`.

## Addresses (devnet)

- Program: `DqqLyrxUPAiJ2m3Fu4uLL6GirTH2cSXXS9wJHmGngaZX`
- TABLE coin, badges, items, sessions: see `GET /status` (`coinMint`), or derive with `pdas()` from `@centerpiece/chain/core`.
