# Destina with Tina

Destina is a responsive player companion for Tina with an arcane tabletop aesthetic. The web app handles room onboarding, profile ingestion, interest review, AI processing, and relic prompt reveals. **The Vision Pro app owns all Game Master interaction.** There are no browser Game Master controls, scoring, timers, relic claims, or simulated delivery.

## The two physical entry points

1. **Tina’s QR → `/join/ROOMCODE`**: a custom QR identifies the correct room. A player enters their name, connects/shares their profile, approves extracted interests, and adds any extras. Joining stores room membership in an HTTP-only cookie on that phone.
2. **Every relic chip → `/c`**: write the **identical absolute URL** to every tap-readable chip. No tag ID, player ID, question ID, or room code is encoded in relic URLs. The server uses the phone's joined room and returns that room's active, Game Master-approved question.

If no question is approved, `/c` shows a waiting state. After an assignment, it shows the new question. Clearing a question returns it to waiting. Private Bounty instructions are included only for the assigned target's session. All other room members receive the public prompt only.

A phone that has not joined a room must onboard through the bot QR (or enter its room code). It cannot infer a room from the universal relic URL. The same browser used for onboarding must open the chip URL, since membership belongs to that browser's cookie. Identical chips cannot prove delivery or identify individual relics, and merely opening `/c` never claims/consumes a relic or changes game state. Physical tags and any NFT association are outside this web implementation; no wallet verification or minting is assumed.

## Run locally

Requires Node.js 20.19+ and npm. SQLite initializes automatically.

```sh
npm install
cp .env.example .env
npm run room -- "The midnight gathering"
npm run dev
```

The room command prints the bot QR destination and universal relic URL. Open the printed `/join/ROOMCODE` link to test onboarding. The root `/` also accepts a room code; players cannot create their own rooms from the browser. Existing joined phones return to their profile/ready screen.

```sh
npm test
npm run build
npm start
```

`npm run dev` serves the frontend and backend at **http://localhost:3000**, with Vite and server hot reload. `npm start` serves the production build. Set `PORT` to change the port. Format with `npm run format`.

SQLite lives in the ignored `data/centerpiece.db`; change `DATABASE_PATH` to override it. Existing JSON session records are preserved; obsolete score/GM fields are no longer exposed. The new player UI does not expose old game dashboards or sample-player controls.

## Player profile flow

- Connect Instagram, paste selected bio/caption text, or load a `.txt` file into the text editor.
- Shared text is submitted to Meta AI only when the player chooses **Find my interests** or explicitly authorizes Instagram import.
- Show extracted suggestions and source excerpts privately to their owner.
- Let the player deselect suggestions and add comma-separated manual interests (up to 12 approved interests).
- **Save & join the circle** confirms what may be used for recommendations.
- Show a simple ready screen explaining the physical relic tap. Players can edit interests at any time or delete their profile data.

There is no fabricated extraction fallback. If a profile is sparse, unsupported, or the model fails, manual interests remain available. `.txt` import accepts selected text up to 16,000 characters; it is not a parser for full Instagram export archives or screenshots.

## Meta AI

Configure the ignored `.env` file and restart:

```dotenv
MODEL_API_KEY=your-meta-model-api-key
MODEL_API_URL=https://api.meta.ai/v1
MODEL_NAME=muse-spark-1.1
```

The server calls Muse Spark through Meta's OpenAI-compatible Chat Completions endpoint, using the configurable model supported by your account. No OpenAI key is used. See the [Meta Model API guide](https://dev.meta.ai/resources/blog/build-with-muse-spark).

The pipeline extracts source-backed interest suggestions, then combines approved interests, relic rules, previous questions, participation, optional GM context, and an optional selected target into three candidate challenges. Candidates include participant IDs, a public prompt, a separate private mission where applicable, duration, evidence IDs, and a short grounding reason. The server checks structure, evidence references, participant counts, target selection, and repeated titles. Ranking favors shared interests, variety, and participants with fewer prior turns.

Each request has an 18-second timeout and bounded output. Invalid structured output gets one repair attempt, with invalid output kept in untrusted user data. Profile content never becomes developer instructions. Failed recommendation generation returns explicitly attributed deterministic fallback candidates to the control interface; only a Game Master assignment makes any candidate visible to players.

Supported relic templates: Duel, Bounty, Hot Seat, Jinx, Forge, and a Golden bonus. Prompts are played and moderated at the table; no audio monitoring, result verification, scoring, crypto payout, or art generation runs here. Interest inference remains provisional until the player approves it; the GM reviews generated questions before assigning one.

Live provider calls have not been verified with project credentials. Automated tests mock Meta and Instagram.

## Instagram setup

The connector uses **Instagram API with Instagram Login**, requesting only `instagram_business_basic`. It supports eligible **Business and Creator accounts**, not ordinary consumer accounts. It cannot read personalized feeds, saved posts, private messages, or a complete interest history.

1. Create a Meta developer app with the Instagram API product and Instagram Login configuration.
2. Add an eligible professional test account and complete its required test authorization.
3. Start an HTTPS tunnel to local port 3000 using your preferred tool. For example, with an installed Cloudflare Tunnel:

   ```sh
   cloudflared tunnel --url http://localhost:3000
   ```

4. Register the exact redirect URL and configure:

   ```dotenv
   PUBLIC_URL=https://your-tunnel-domain.example
   INSTAGRAM_APP_ID=your-instagram-app-id
   INSTAGRAM_APP_SECRET=your-instagram-app-secret
   INSTAGRAM_REDIRECT_URI=https://your-tunnel-domain.example/api/instagram/callback
   INSTAGRAM_GRAPH_VERSION=v25.0
   TOKEN_ENCRYPTION_KEY=64-hexadecimal-characters
   ```

   Generate the encryption key with `openssl rand -hex 32`. Never commit secrets.
5. Restart, generate the bot QR using that HTTPS origin, and join via that origin before connecting Instagram. Encode `${PUBLIC_URL}/c` on **every** relic chip. Localhost links do not work on other phones.
6. Validate one test account's actual fields. The import notice reports available and unavailable fields. Broader access depends on Meta's current review and access requirements.

The connector imports supported profile text and up to 12 recent captions, probing optional biography/type/caption fields separately. Unsupported fields do not fabricate data or fail the entire import. OAuth state is session-bound, one-time, and expires after ten minutes. Tokens are encrypted with AES-256-GCM and purged after expiry; this immediate-import release uses short-lived tokens and requires reconnecting for another import rather than running a refresh/sync service.

### ngrok alternative for HTTPS testing

If Cloudflare Tunnel cannot connect on the current network, install the official ngrok client with `brew install ngrok`. Create an ngrok account and paste its **agent authtoken** into the ignored `.env` file as `NGROK_AUTHTOKEN`. This is separate from the Muse key and the ngrok management API key.

With the app running on port 3000, run `npm run tunnel`. The launcher reads `.env` and redacts the token from any agent output. Retrieve the HTTPS forwarding address from ngrok, set `PUBLIC_URL` to that origin and `INSTAGRAM_REDIRECT_URI` to its `/api/instagram/callback` URL, then restart the app. Register the exact same callback in Meta's Instagram Business Login settings. Use the HTTPS origin for both onboarding and the Instagram connection. Keep the app and tunnel running while testing.

## Game Master / bot integration boundary

The actual Vision Pro UI and application WebSocket are **deferred**. The current processing operations are available through a small authenticated HTTP control API, and shared transport-neutral types/event envelopes are ready for a future adapter. Player browsers currently poll: room/profile metadata every 10 seconds; the open relic view every 4 seconds and on returning to the tab. A fresh chip navigation always fetches the current question with caching disabled.

Set `GM_API_KEY` to a securely generated server-side control credential (`openssl rand -hex 32`). Keep it out of browser code, chip URLs, and room QR codes. Calls from the trusted bot/Vision Pro adapter use `Authorization: Bearer <GM_API_KEY>`. Without configuration the control API fails closed with 503; player cookies cannot authorize it. Use HTTPS outside local development.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/control/rooms` | `{name}` → create room; return `joinPath` and common `capsulePath` |
| `GET /api/control/rooms/:code` | Read approved roster, candidate options, and active question |
| `POST /api/control/rooms/:code/recommendations` | `{context?, targetPlayerId?}` → generate 3 candidates |
| `POST /api/control/rooms/:code/assign` | `{recommendationId, instructions?}` → approve a candidate and set the active question |
| `POST /api/control/rooms/:code/clear` | `{status:"completed"|"passed"}` → clear active question and record participation |
| `POST /api/control/rooms/:code/finish` | Close room and remove raw source excerpts |

Choose the target through `targetPlayerId` when requesting recommendations; every returned candidate puts that player first. To change targets, request fresh grounded candidates for the new player rather than blindly substituting names into an old question. Assignment accepts an optional edited public instruction. Candidates are invalidated by interest changes; in-flight generation is rejected if room state changes. Clear the active question before generating/assigning the next one. Repeated reads are safe; duplicate assignments are rejected. Only one question is active per room.

`shared/types.ts` defines `Snapshot` (private player profile), `CapsuleSnapshot` (role-filtered active prompt), `ControlSnapshot` (trusted GM state), and `RoomEvent`. `createApp().setEventSink()` accepts an internal event consumer. Its envelope is `{schemaVersion:1,type,roomId,roomVersion,at}`; it contains no secret text. A later WebSocket adapter can subscribe to these events and obtain the appropriate snapshot after authenticating the recipient. Nothing currently opens a game WebSocket port or sends GM state to players.

### Player HTTP interfaces

| Endpoint | Purpose |
| --- | --- |
| `GET /api/rooms/:code` | Minimal public onboarding metadata |
| `POST /api/join` | `{code,name}` → join and issue a room-bound cookie |
| `GET /api/session` | Current player's profile and room metadata only |
| `GET /api/capsule` | Current approved prompt for that player's room; `prompt:null` while waiting |
| `GET /api/instagram/connect` | Begin Instagram linking |
| `GET /api/instagram/callback` | Consume OAuth state and import supported text |
| `POST /api/profile/text` | `{text}` → extract interest suggestions |
| `POST /api/interests` | `{approvedIds,labels}` → approve suggestions and add manual interests |
| `DELETE /api/profile` | Delete own sources/interests and disconnect |

Player cookies are HTTP-only, SameSite=Lax, and Secure for an HTTPS `PUBLIC_URL`; their credentials are stored hashed. Browser mutations reject foreign origins. Private sources and pending interests are visible only to their owner; public relic responses omit the recommendation queue, evidence IDs, model reasoning, and private missions for other players. Finished rooms show no active prompt. Rejoining the same room with the same browser does not add a duplicate player. Joining another room explicitly changes that browser's active room.

## Source layout and verification

- `src/`: player onboarding, profile review, ready state, and universal relic view; mobile controls and reduced-motion styles.
- `server/`: HTTP operations, SQLite, Instagram, encryption, Meta generation, room state, and future transport event boundary.
- `shared/types.ts`: player/control contracts.
- `scripts/room.ts`: local room provisioning; the bot can later use the control API instead.
- `tests/`: shared URL behavior, target privacy, room isolation, control authorization, source review, persistence, provider failures, target selection, OAuth states, encryption, stale candidates, and room closure.

Raw profile text is removed when its owner deletes it or the room closes. Approved interests and prior assigned prompts remain in the room's internal history to support generation; deleting a profile does not rewrite questions already assigned. SQLite uses versioned JSON room aggregates plus credential, connection, OAuth, and event tables. No extra migration is needed for the local prototype. Keep the database and encryption key together if backing up data.

### Private question review and Muse credit limits

Run `npm run questions -- ROOMCODE --sample --serve` for a free local template
preview at http://localhost:3001. `--sample` adds preview-only players when fewer
than three ready players exist; it does not create accounts or alter the room.
Use `--live` to explicitly request one batch of three Muse candidates (at most one
repair). Subsequent runs without `--live` reuse the saved result for the same
inputs. Browser refresh never invokes AI. Files live in ignored
`data/question-previews/` and include private Bounty text: keep them private.
This developer preview does not assign questions or replace Vision Pro controls.

All model calls now reserve a persistent request slot before sending. The default
`MODEL_MAX_REQUESTS=100` counts extraction, generation, repairs, and failed sends
from this point forward. `MODEL_USAGE_PATH` stores the durable local ledger.
Reaching the cap uses the existing manual-interest/template fallback. The cap
cannot guarantee a dollar amount; provider billing is authoritative, and it does
not include earlier usage or other applications. Do not delete the ledger to
reset usage accidentally. Review quality using the rubric on the preview before
spending more on regeneration. Real testing needs only one Instagram connection;
other players can join separate browser sessions and approve manual interests.

### Visual direction

Destina uses relics for the objects Tina carries. Public URLs and API field names
remain compatible with the existing tap tags and control adapter. The player
interface uses Cormorant Unicase for the lowercase destina wordmark and Space Grotesk
for headings, body text, and controls, with parchment panels, charcoal and moss, and
flat rust-colored actions. The private preview presents questions as numbered
reading rows. Gradients, glow effects, decorative rune graphics, sparkle icons,
and glass effects are removed. Profile excerpts remain verbatim.

Cormorant Unicase and Space Grotesk are served locally from `public/fonts`,
including their SIL Open Font License notices. Players do not need a Google Fonts
connection to load the typography.
