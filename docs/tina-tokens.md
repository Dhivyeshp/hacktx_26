# Tina Tokens

The game frontend calls the currency Tina Tokens. Settlement uses the existing
Token-2022 program on Solana devnet. The existing deployed mint may still appear
as TABLE or Centerpiece Coin in external wallets and explorers. No mint metadata
or chain program was renamed or upgraded by this integration.

## Running a round

1. Complete a prompt in `/gm`, then use the Tina Tokens shortcut.
2. Select the completed round. Review every player, checking only actions you
   observed. No awards are issued just because a round was completed.
3. Contribution earns 2, a thoughtful follow-up 3, building on an idea 2,
   inviting someone into the conversation 2, and finishing something together 1.
   Each criterion can be used once per player per round, for a maximum of 10.
4. Bonuses require a short GM observation or confirmed microphone evidence from
   that player and round. Pasted test text and anonymous voices are ineligible
   as evidence. Manual observations support testing without a microphone.
5. Approve awards. Players now see pending Tina Tokens on their profiles.
6. Choose Settle on Solana devnet and confirm. Wallets are created and registered
   as needed. Refreshes/polling reconcile the displayed result without resending
   transactions. Retry is explicit if a provider request fails.

Passed rounds receive zero, with no penalty. Word count, speaking duration,
oversharing and inferred personal traits are never scoring inputs. Completed
rounds and shared partners are GM-confirmed game involvement; named speech counts
describe only the retained transcript, not quality or lifetime talk time.

Muse may suggest evidence-based award criteria during the existing conversation
question request, adding no separate model call. Suggestions require a completed
round and real microphone segments whose speaker has been confirmed. Invalid or
insufficient reward evidence is discarded without discarding valid prompts.
Use these suggestions fills the GM draft; it does not approve or settle awards.

## Game Master controls and stats

The GM sees confirmed/pending balances, levels, completed/passed rounds, distinct
shared partners, retained named speech segment counts, criterion counts, wallets,
round reviews, settlement state and available transaction links. Pending reviews
can be edited. Once settlement starts, amounts are fixed for that round.

Pause new awards prevents new approvals and settlement requests; it cannot stop
a transaction already submitted. The shared goal defaults to 40 and can be set
between 10 and 1,000 before settlement starts. Goal progress uses approved awards;
confirmed totals remain shown separately. Reaching the goal earns a shared finale
that the GM can mark celebrated. Tina's physical celebration remains simulated;
this is not an additional token payout. No shop or cash-out flow is included.

Levels use confirmed awards: `1 + floor(sqrt(confirmed / 10))`. Tokens are not
spent in this release. Shared-partner stats are local game stats; the integration
does not write inferred social connections to player badges on chain.

## Server setup

Configure only on the game server:

```dotenv
CHAIN_SERVICE_URL=https://your-chain-service
CHAIN_API_TOKEN=your-server-only-credential
TOKEN_ENCRYPTION_KEY=64-hexadecimal-characters
```

The service must implement the repository's chain API: GET `/status` returns
`{ok:true, cluster:"devnet", initialized:true}`; POST `/players` registers a
supplied wallet; GET `/sessions/:id` returns its goal or 404; POST `/sessions`
opens one; POST `/rounds/settle` performs the receipt-protected round settlement.
Mainnet is rejected before wallet creation or chain writes. The game server
does not use or expose the chain admin's signing key.

Player keypairs are generated on the game server and encrypted with AES-256-GCM
in SQLite before registration. Only public addresses are sent to the chain
service. Keys and API tokens never appear in player or GM snapshots. Back up
the database and encryption key together. There is no player key-export UI.

The browser sends criteria, not trusted token amounts. Server validation computes
the score, checks player/round membership and evidence, and enforces GM access
outside demo mode. Public demo mode intentionally lets anyone with `/gm` approve
and settle devnet awards. Keep it disabled before introducing valuable assets.

## Persistence and failure recovery

Every game has a reward ID separate from the room link. Reset game creates a
fresh reward ID, clears displayed balances and players, stops audio, and removes
GM observation notes and transcript references from archived reward reviews.
Encrypted custodial wallets, numeric settlement records and blockchain history
remain for reconciliation. Reset waits for an active settlement to finish.
Profile reset clears profile data while keeping that player's earned tokens.

Reviews, encrypted wallets, frozen settlement payloads and per-wallet receipts
are durable. A timeout does not create a new wallet: retries register the same
saved address. Partial settlements retain confirmed players while retrying the
same frozen awards through the program's once-per-round receipts. On restart,
processing jobs become retryable; no automatic minting resumes.

Only an event hash, pseudonymous wallet addresses, integer awards and the chain
session/round identifiers are sent on chain. Names, transcripts, profiles and GM
observation text stay off chain. The hash binds the approved award record.

## Verification

The automated suite checks score caps, duplicate criteria, evidence identity,
anonymous/test text rejection, GM permissions, partial settlement reconciliation,
wallet reuse, encryption, pausing, goal locking and mainnet rejection. A separate
live devnet smoke game settled 4 tokens across two generated test wallets. It did
not change the real demo players and used no Muse requests.
