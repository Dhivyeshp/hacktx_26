# The Game Master on Vision Pro

The web console at `/gm` and the headset app used to be two programs that
shared a name and nothing else. `/gm` knew about rooms, people, prompts and
tokens but nothing about the robot. The headset knew about the robot camera and
hand driving but every person, prompt and transcript line in it was a literal
in `DemoSession.swift`.

This document describes the join: the headset is now the Game Master, driven by
the same server endpoints the browser uses, and picking a prompt is what
unlocks driving.

## What a round looks like now

1. People join on their phones and save interests. The roster panel on the
   left fills in with names, readiness and turn counts.
2. The Game Master chooses a spotlight and optionally types a line of context,
   then asks for three prompts: from profiles, from the conversation, or from
   the free question library.
3. Three cards appear on the stage panel. Each shows the prompt, who it is for,
   and the reason the server grounded it on. The wording can be edited first.
4. Choosing a card calls `assign` on the server. The prompt is now on the
   assigned player's phone at `/prompt`, and Tina's badge is told to show the
   title.
5. Only then does the stage switch to driving. Firm fists steer; the live Pi
   camera is straight ahead; arming and the pinch-and-hold drop are unchanged.
6. After the capsule lands, the stage asks for the outcome. Mark completed or
   pass, and the next set can be generated.
7. Tina Tokens are awarded per round against the five fixed criteria, then
   settled on devnet.

## Why assign happens before driving

The phone has to be showing the prompt by the time the robot arrives. Driving
first and assigning on dispense would mean the capsule lands before anyone can
read anything, and a failed assign would strand a delivered capsule with no
prompt behind it. Assigning first also gives the motion gate something concrete
to check: without an assigned prompt there is no target, so the wheels stay
still.

## Layout

The old interface was one 1280 by 800 panel anchored 1.6 m ahead. It is now
five attachments on the same one-shot head anchor, so the workspace stays
still while the wearer looks from one part of it to another. A continuously
head-locked interface would chase the gaze.

| Panel | Where | What |
| --- | --- | --- |
| Camera | ahead, 2.0 m | the live Pi feed, or the demo photo |
| Roster | left, turned 26 degrees in | everyone here, readiness, turns, tokens |
| Conversation | right, turned 26 degrees in | transcript, speaker hints |
| Stage | below, tilted up 18 degrees | choose, drive, or record the outcome |
| Modals | nearest, 1.15 m | camera settings, tokens, session, page preview |

Opening a modal suspends the controls underneath, which is what keeps the
wheels still while one is open.

## Connecting to the server

The headset authenticates with a bearer credential against the
`/api/control/rooms/:code/*` routes. These share their handlers with the
`/api/questions/*` routes the browser uses, so both clients run the same
server code. The cookie flow, invites and the browser sign-in are not ported;
they exist for browsers.

Put the three values in `apple-vision/.env` next to the relay ones:

```sh
DESTINA_URL=https://destina.ngrok.app
DESTINA_ROOM=ABC123
GM_API_KEY=<the server's GM_API_KEY>
```

`Scripts/build_relay_config.py` copies them into the generated
`RelayConfig.plist` at build time. It allowlists exactly these keys, rejects a
URL carrying credentials or a query, and refuses plain `http://` for anything
other than localhost, because the key would otherwise travel in the clear.

**`GM_API_KEY` is a global credential, not a room-scoped one.** A build that
carries it can change any room on that server. Treat the built app
accordingly and do not hand it around.

With `DESTINA_URL` blank the app still runs. It opens in demo mode with the
mocked table, which is what makes the simulator useful without a server.

## Keeping the feed honest

Polling a server every four seconds invites three specific bugs, and the
browser already solved all three. The same guards are in `DestinaClient`:

- **Overlapping polls.** A `fetching` flag means a slow request is never
  racing its own successor.
- **Stale responses after a reconnect.** A `runID` generation token is checked
  before anything is written back, the same pattern `RelayClient` and
  `HandMotionController` use.
- **A slow poll overwriting a fresh mutation.** Snapshots carry a room version,
  and one older than what is on screen is discarded. Without this, a poll
  started just before an assign can land just after it and put the prompt back
  on the shelf.

Every mutation awaits, then refreshes. Nothing guesses at the resulting state,
because the server is the thing that decides it.

A 403 or 503 means the credential is wrong or the server has none. Neither is
fixable by retrying, so the client stops polling and says so rather than
hammering the endpoint.

## Rules that are ported, not approximated

These are server rules. A headset that disagreed would offer a button that
returns an error.

- Prompts can be generated only when everyone who has joined has saved at
  least one interest, there are enough people, and no prompt is on the table.
- The question library costs no Muse request and stays available after the
  paid allowance runs out. It is a separate button for that reason.
- A card can be used only while it is still in the live queue. Older batches
  stay visible, labelled as saved from an earlier set.
- Edited wording needs at least 15 characters.
- Rewards review every current player exactly once, so an unscored person is
  sent as an empty award rather than left out.
- Anything beyond "Contributed to the prompt" needs a written observation or
  confirmed transcript evidence.
- Speaker identity is never assigned automatically. Deepgram separates voices
  but does not know names, so a hint is a question the Game Master answers.

## Live transcription

The headset can listen. In the expanded conversation panel, confirm that
everyone agreed to be recorded, then choose **Listen on this headset**.

It requests a one-use audio ticket, opens `/api/audio`, sends the ticket as
the first text frame, waits for the server's `ready`, and then streams
microphone audio as 16 kHz mono signed 16-bit PCM, the same `linear16` format
the Tina adapter sends. The server forwards it to Deepgram and stores the
final transcript text, never the audio.

Things that are deliberate rather than incidental:

- **Consent is a precondition, not a formality.** The control stays disabled
  until it is confirmed, and the confirmation is sent to the server.
- **A level meter, not just a status.** A connected socket does not prove a
  working microphone, so the panel shows audio actually arriving.
- **Backpressure stops rather than queues.** `URLSessionWebSocketTask` exposes
  no buffered-byte count, so unacknowledged frames are counted; a microphone
  that outruns the uplink stops listening instead of sending minutes of stale
  audio.
- **The microphone is released** when the panel closes, on leaving the
  immersive space, and on backgrounding.
- One room can have one stream. If a phone or Tina is already listening the
  panel says so rather than fighting for the slot.

Tina's microphone or a phone can still do the capture instead; the headset
then just reads the result over HTTP.

## The transcript and TigerDB

The server dual-writes every final segment into a TigerDB hypertable, and the
headset pages forward from the newest segment it already holds rather than
refetching the transcript every four seconds. See
[TigerDB transcript store](../../docs/tigerdb.md). With TigerDB unconfigured
the same endpoint serves the in-session copy and the panel says which source it
is reading.

## The motion gate

The chain between a held fist and a `drive` frame is unchanged except for one
new clause at the front:

```swift
if store.stage(for: client.feed) != .driving && client.isConfigured {
    return "no prompt is assigned yet"
}
```

Nothing else was loosened. Live video is still required, the three second
stale-frame cutoff still applies, an armed drop still blocks movement, and the
open-hands reset is still required after a tracking gap. The hand recognition
in `HandMotionInput.swift` and `HandMotionController.swift` was not touched.

`DemoSession` now mirrors the server's assigned prompt. Clearing the prompt on
the server stops hand driving, so a cleared round cannot leave the wheels live
against a target that no longer exists.

## Design

The headset used a mint accent that had nothing to do with Destina. It now uses
the real token set from `src/design-tokens.css`: charcoal and cream surfaces,
tan as the only accent, sage only on status dots. Headings are italic Cormorant
Garamond, the wordmark is Cormorant Unicase and the interface text is Space
Grotesk, all registered at launch from the same font files the website serves.

Destina's panels are square hairline frames with no shadows. Against passthrough
a hairline alone is not legible, so the frame sits on a material substrate
while keeping its square corners and 1px border. The pill primary button is the
one deliberately round element.

## Files

| File | What |
| --- | --- |
| `DestinaConfig.swift` | reads the generated plist, builds bearer requests |
| `DestinaModels.swift` | decodable mirrors of `shared/types.ts` and `shared/rewards.ts` |
| `DestinaClient.swift` | polling, mutations, the three concurrency guards |
| `GameMasterStore.swift` | the stage machine, workbench input, confirmations |
| `DestinaTheme.swift` | palette, type, panel and button styles |
| `GameMasterHUD.swift` | camera screen, stage panel, connection panel, lifecycle |
| `RosterPanel.swift` | everyone here |
| `PromptWorkbenchView.swift`, `PromptCardView.swift` | generating and choosing |
| `CurrentPromptView.swift` | on the table, outcomes, player preview |
| `DriveControlsView.swift` | delivery framing around the existing hand controls |
| `ConversationPanel.swift` | transcript, speaker hints and mapping |
| `TokensPanel.swift` | Tina Tokens and the session controls |

`DashboardView.swift` is gone; its camera, header and settings logic moved into
`GameMasterHUD.swift`. `RobotControls.swift`, `HandMotionController.swift` and
`HandMotionInput.swift` are unchanged.

Every new Swift file is registered in four places in the hand-written
`project.pbxproj`, and the font files in the resources phase.

## Checks

```sh
xcrun swiftc -parse-as-library Centerpiece/DestinaModels.swift \
  Centerpiece/DestinaConfig.swift Tests/DestinaClientChecks.swift \
  -o /tmp/centerpiece-destina-checks && /tmp/centerpiece-destina-checks
```

This covers decoding a captured feed, the version gate, the error envelope,
the reward point cap and that the credential never reaches the URL. The
existing demo, hand and relay checks still run as before.

Hand recognition and motor direction cannot be validated in the simulator. See
[movement controls](movement-controls.md) for the headset procedure.
