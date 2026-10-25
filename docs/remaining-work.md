# Destina remaining work

Updated October 25, 2026. This separates working browser features from integrations that still need to be connected or verified.

## Working now

- [x] Room onboarding, Instagram import for configured eligible test accounts, manual interests and saved/edit states.
- [x] Mobile layouts, light and dark appearance, profile reset and an explanation of imported text.
- [x] Muse generation with grounding checks, bounded requests, a persistent usage cap and labeled fallback prompts.
- [x] Private GM feed with suggestion history, player names, interest readiness and recorded turns.
- [x] `/prompt` shows the selected question; old `/relic` and `/c` links redirect there. Bounty text is filtered by player identity.
- [x] Stable public testing domain at `https://destina.ngrok.app`.

## Next for a complete game test

- [ ] Configure the server's `GM_API_KEY` and provision it securely to the trusted Vision Pro adapter. The room-scoped browser access link only grants read access.
- [ ] Connect the web app to the existing relay at `wss://centerpiece-relay.onrender.com/ws`. The relay exists; the Destina adapter is still missing.
- [ ] Map Vision Pro requests to the protected room operations for generating prompts, choosing or editing a question, selecting valid targets and recording completed or passed outcomes.
- [ ] Agree on room IDs, message schemas and authentication across Destina, Vision Pro and Tina. The existing relay contract and Destina snapshots need an explicit mapping.
- [ ] Send role-filtered updates, retain server membership checks and recover authoritative state after reconnects. Keep private missions and the GM feed out of public channels.
- [ ] Run one full round with at least three real phones and Vision Pro: join, approve interests, generate once, choose, tap, reveal private text, record an outcome and advance.
- [ ] Write `https://destina.ngrok.app/prompt` to new NFC tags and verify iOS and Android taps open the browser used for onboarding. Existing tags remain supported through redirects.
- [ ] Verify the new Instagram redirect URI is saved in Meta and complete one real OAuth round trip on the new domain. Local configuration is updated; saving Meta's settings alone does not verify a full login.

## Before opening beyond invited testers

- [ ] Complete Meta's required review and access verification for the permissions actually used. Confirm supported account types and keep a clear manual-interest path for unsupported accounts.
- [ ] Provide published privacy and deletion information, implement the required Meta deauthorization/deletion callbacks and verify retention behavior.
- [ ] Choose always-on hosting for Express, persistent SQLite storage and backups. The ngrok setup currently needs the laptop, app and tunnel to stay running.
- [ ] Configure production secrets, HTTPS origin and callback URLs; verify restart recovery and access expiry in that environment.
- [ ] Review public-endpoint abuse protection and enforce the Muse request allowance across every deployed generator. The local request cap is not a dollar budget or an account-wide provider spending limit.
- [ ] Evaluate question quality with representative approved interests, including sparse profiles and similar player names. Use saved batches before paying for another generation.

## Later conversation features

- [ ] Define recording consent, who can access transcripts and how long text is retained.
- [ ] Add authenticated transcript ingestion with speaker IDs and timestamps.
- [ ] Store conversation-based suggestion batches and render the real transcript in the private Conversation view.
- [ ] Add explicit or rate-limited generation triggers, caching and a spending allowance for ongoing suggestions. Opening the page must continue to be free of model requests.

## Separate hardware and bonus work

- [ ] Verify Tina delivery acknowledgements and their relationship to the selected question. One identical URL cannot identify which physical tag was tapped.
- [ ] Connect and validate any intended audio, generated art or on-chain rewards separately. Their presence elsewhere in the repository does not mean they are integrated into this browser game flow.
