# Solana: `centerpiece` Anchor program

Custom Anchor 1.1.2 program on devnet, built on Token-2022 with no Metaplex dependency.

| What | How |
| --- | --- |
| **TABLE coin** | Token-2022 mint at PDA `["coin"]` with on-chain metadata. Its mint authority is the PDA `["mint_auth"]`, so coin can only be created through this program's `award_player`. |
| **Player badge** | One soulbound NFT per wallet (`NonTransferable` + `MetadataPointer`). Metadata fields `level`, `xp` and `connections` are rewritten on chain every time the player is paid. |
| **Round attestation** | `attest_round` stores the sha256 of the round's off-chain event log at PDA `["round", session, round_no]`. The account can only be created once. |
| **Payouts** | `award_player` mints coin, adds xp and connections, and levels up the badge. A receipt PDA `["award", round, wallet]` blocks double pay. Awards are capped by `max_award_per_round` and limited to the attested player count. |
| **Keepsakes** | `mint_keepsake` mints a transferable 1-of-1 Token-2022 NFT whose on-chain fields are `image`, `challenge`, `session`, `round` and `number`. |

Only the `admin` key stored in `Config` (the game server) can register players, attest rounds, award or mint. Transcripts, names and camera data never go on chain.

Points are earned for interacting with people. The scorer (off chain, built by the data owner) sends `{ wallet, points, connections }` per player. The program enforces the cap, pays once per round, and turns xp into badge levels with `level = 1 + floor(sqrt(xp / 10))`.

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
npm run chain:test                # local validator + full test suite

solana config set --url devnet
solana address                    # fund this at https://faucet.solana.com (deploying needs ~4 SOL)
cd solana && anchor deploy --provider.cluster devnet
CHAIN_PUBLIC_URL=https://centerpiece-chain.onrender.com npm run chain:init   # creates Config + TABLE coin
npm run chain:smoke               # registers 2 players, settles a round, mints a keepsake
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
