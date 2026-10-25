# Solana: `centerpiece` Anchor program

Custom Anchor 1.1.2 program on devnet, built on Token-2022 with no Metaplex dependency.

| What | How |
| --- | --- |
| **TABLE coin** | Token-2022 mint at PDA `["coin_v2"]` with on-chain metadata. Its mint authority **and permanent delegate** are the PDA `["mint_auth"]`, so coin is only created, moved or burned through program rules. |
| **Player badge** | One soulbound NFT per wallet (`NonTransferable` + `MetadataPointer`). Metadata fields `level`, `xp`, `connections`, `kudos` and `achievements` are rewritten on chain as the player plays. |
| **Round attestation** | `attest_round` stores the sha256 of the round's off-chain event log at PDA `["round_v2", session, round_no]`. The account can only be created once. |
| **Payouts** | `award_player` mints coin, adds xp and connections, and levels up the badge. A receipt PDA `["award_v2", round, wallet]` blocks double pay. Awards are capped by `max_award_per_round` and limited to the attested player count. |
| **Table goal** | `open_session` sets a shared goal. Every award in the session fills the pot, and reaching the goal emits `TableGoalReached`. `claim_table_bonus` then pays each wallet that played, once, proven by its Award receipt. |
| **Kudos** | `give_kudos` moves 1–10 TABLE from one player to another through the permanent delegate. The admin signs for custodial players, or the wallet signs itself. There is a 60 s cooldown per pair (`KudosLink` PDA), and the first kudos between two people adds a connection for both. |
| **Shop** | `create_item`/`update_item` manage an on-chain catalog (price, stock, minimum level). `redeem_item` **burns** the price and writes a numbered `Receipt`, which the hub marks done with `fulfill_receipt`. |
| **Achievements** | A bitmask on the Player. Bits 0–15 unlock automatically from stats: first round, icebreaker, social butterfly, level 3/5, generous, appreciated, collector, shopper and team player. Bits 16 and up are granted by the server through `grant_achievement` (quiet hero, bounty hunter, duel champion, golden grab). |
| **Keepsakes** | `mint_keepsake` mints a transferable 1-of-1 Token-2022 NFT whose on-chain fields are `image`, `challenge`, `session`, `round` and `number`. |

Building the web app? See **[FRONTEND.md](FRONTEND.md)** for REST routes, live events and the browser SDK.

Only the `admin` key stored in `Config` (the game server) can register players, attest rounds, award, mint, list items or grant achievements. Kudos and redemptions accept the admin or the wallet itself. Transcripts, names and camera data never go on chain.

Points are earned for interacting with people. The scorer (off chain, built by the data owner) sends `{ wallet, points, connections }` per player. The program enforces the cap, pays once per round, and turns xp into badge levels with `level = 1 + floor(sqrt(xp / 10))`.

## Devnet deployment

| | |
| --- | --- |
| Program | [`DqqLyrxUPAiJ2m3Fu4uLL6GirTH2cSXXS9wJHmGngaZX`](https://explorer.solana.com/address/DqqLyrxUPAiJ2m3Fu4uLL6GirTH2cSXXS9wJHmGngaZX?cluster=devnet) |
| TABLE coin mint (v2) | [`5BD4dqTvkEtUz4pWhyQ7vv1VDofKvsZy1X9aUKQ1pkMg`](https://explorer.solana.com/address/5BD4dqTvkEtUz4pWhyQ7vv1VDofKvsZy1X9aUKQ1pkMg?cluster=devnet) |
| Admin / upgrade authority | `Ge77yDtK9UsxEfvtF63G5MVuHxuNvm72acp7j6g6kXZJ` (devnet only) |
| Chain service | `https://centerpiece-chain.onrender.com` (`/healthz`) |

The public devnet RPC rate-limits deploys (429s). Use a Helius devnet URL as `SOLANA_RPC` and `--url` for deploys. Helius rejects requests from Render's IPs (403), so the Render service uses the public RPC.

v2 moved every PDA to `*_v2` seeds, so v1 accounts from the first deploy (coin `EpxW…`, old badges) are simply ignored.

## Layout

```
programs/centerpiece/src/   lib.rs, state.rs, error.rs, constants.rs, token_meta.rs, instructions/*
tests/centerpiece.test.ts   anchor test (local validator): rules, soulbound, caps, double pay, keepsakes
client/                     @centerpiece/chain: ChainClient (TS) + HTTP service + scripts
```

## Build, test, deploy

```bash
# toolchain: Rust, Agave CLI 4.x, Anchor 1.1.2 (avm)
npm install                       # repo root
npm run chain:build               # anchor build + copy IDL/types into client/src/idl
npm run chain:test                # solana-test-validator + full test suite (15 tests)

solana config set --url devnet
solana address                    # fund this at https://faucet.solana.com (deploying needs ~4 SOL)
cd solana && anchor deploy --provider.cluster devnet
CHAIN_PUBLIC_URL=https://centerpiece-chain.onrender.com npm run chain:init   # creates Config + TABLE coin
npm run chain:seed-shop           # lists the 5 game-night perks
npm run chain:smoke               # every flow: register, table goal, round, kudos, shop, bonus, achievement, keepsake
```

`CHAIN_PUBLIC_URL` is written into on-chain metadata URIs, so set it to the deployed chain service before running `init` or registering anyone.

## Using it from the game server

TypeScript:

```ts
import { ChainClient } from '@centerpiece/chain'
const chain = ChainClient.fromEnv()
const w = chain.createCustodialWallet()                 // store w.secretKey with the player
await chain.registerPlayer(w.publicKey)
await chain.settleRound({ sessionId, roundNo, eventsHash, awards: [{ wallet, points, connections }] })
await chain.mintKeepsake({ sessionId, roundNo, wallet, name, image, challenge })
```

From any language, call the chain service (`npm run chain:serve`, or the Render service). Write endpoints need `Authorization: Bearer $CHAIN_API_TOKEN`.

```bash
curl -X POST $CHAIN/players -H "authorization: Bearer $TOKEN" -d '{}'          # custodial wallet + badge
curl -X POST $CHAIN/rounds/settle -H "authorization: Bearer $TOKEN" -d '{
  "sessionId": "8f6c…", "roundNo": 2, "eventsHash": "<64 hex chars>",
  "awards": [{ "wallet": "…", "points": 12, "connections": 2 }] }'
curl -X POST $CHAIN/keepsakes -H "authorization: Bearer $TOKEN" -d '{
  "sessionId": "8f6c…", "roundNo": 2, "wallet": "…", "name": "Forge: Pocket Volcano",
  "image": "https://…/forge.png", "challenge": "forge" }'
curl $CHAIN/players/<wallet>                                                    # level, xp, coins, badge fields
```

Public metadata, which wallets and the explorer fetch: `/meta/coin.json`, `/meta/badge/<wallet>.json` (a live SVG that shows the current level) and `/meta/keepsake/<mint>.json`.
