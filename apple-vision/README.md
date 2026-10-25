# Centerpiece · Vision Pro

The Destina Game Master, in full immersion. The Pi camera is straight ahead, the roster and the live conversation are angled in from the sides, and a stage panel below changes with what you are doing: choose a prompt, drive Tina to the person it is for, then record how the turn went.

It runs against the same Destina server the browser console at `/gm` uses. See [the Game Master port](docs/gamemaster-port.md) for the full picture.

## Open the right project

Open `Centerpiece.xcodeproj` **from this checkout**, select the Centerpiece scheme and your paired Vision Pro, select your signing team, and Run. On first launch, the app automatically requests a full immersive space and hides its small launcher window after the space opens. This project requires visionOS 2 or newer and Xcode's visionOS support. The current Codex worktree is separate from the original checkout; changes here do not automatically appear in the other Xcode project window.

## Immersive presentation

The app starts in **full immersion**: passthrough and other apps are hidden. The workspace is five panels placed once at head height and then left still, so you look from one to another instead of the interface chasing your gaze. The Pi feed is still a normal 2D camera image; this is a wide theater-style presentation, not 360-degree video.

- **Exit immersive** in the top bar returns to the small launcher window.
- **Enter immersive view** opens the space again. Video source settings are retained, and the assigned prompt comes back from the server.
- If opening is canceled or fails, the launcher explains what happened and offers retry.
- A system dismissal also restores the launcher and stops/disarms motion. It does not automatically reopen until you request it.
- Camera settings, Tina Tokens, session controls and the player preview open as panels nearer the wearer. Opening one suspends the controls underneath, which keeps the wheels still.

## Add the relay token and the Destina server

1. In this `apple-vision` directory, edit `.env`. If it is missing, copy `.env.example` to `.env`.
2. Set `RELAY_TOKEN` to the value from Render → centerpiece-relay → Environment. Do not put it in Swift source or chat.
3. Leave `RELAY_URL=wss://centerpiece-relay.onrender.com/ws` and `RELAY_ROOM=table` unless your relay uses a different endpoint/room.
4. Build and run again. Every build reads `.env` into the development app's generated `RelayConfig.plist`; `.env` itself is not copied into the bundle and is ignored by Git. Changing `.env` requires rebuilding/reinstalling.
5. With a token configured, the app automatically connects and waits for binary JPEGs from the Pi in the same room. Camera settings (top right) let you reconnect or switch to the demo photo.
6. For the game itself, also set `DESTINA_URL`, `DESTINA_ROOM` and `GM_API_KEY`. Leave `DESTINA_URL` blank to build a demo-only app with no server connection. `DESTINA_URL` must be `https://` unless it points at localhost, because the key would otherwise travel in the clear.

The development app contains both credentials in its generated configuration so it can authenticate on the headset. Treat the built app as a credential-bearing artifact.

`GM_API_KEY` is a **global** Game Master credential, not a room-scoped one: a build that carries it can change any room on that server, and it is the same key the bearer control API accepts. Do not distribute such a build, and do not share it with the relay token. The build script allowlists exactly the six configuration keys, never sources `.env` as shell code, and never prints its values.

## Live and mocked features

**Live:** the whole Game Master loop against the Destina server. Real joined players and their interest readiness, Muse and question-library generation, prompt editing and assignment, completing and passing, the transcript with speaker confirmation, Tina Tokens approval and devnet settlement, finishing and resetting. Also the WebSocket video connection, presence, JPEG decoding, stale-frame detection, reconnection, ARKit hand input on the headset, wheel commands after enabling hand driving in live mode, and the badge-screen update sent when a prompt is assigned. Video keeps its original aspect ratio.

**Mocked:** capsule dispensing. The app sends `drive`, `stop` and `screen` commands to the Pi; it does not send a real dispense command yet, so the drop and its acknowledgment are still local. Movement is mocked only in demo photo mode. With no `DESTINA_URL` configured the whole table is the old local demo, behind a visible notice. The illustrative photo is generated artwork, not a camera capture.

The headset can listen to the room: confirm consent in the conversation panel and choose **Listen on this headset**. It streams 16 kHz mono PCM to the server's `/api/audio` bridge, which forwards it to Deepgram and stores the transcript text, never the audio. This needs `DEEPGRAM_API_KEY` on the server, counts against the room's minute allowance, and only one device can listen per room. Tina's microphone or a phone can do the capture instead; the headset then just reads the transcript over HTTP, served from [TigerDB](../docs/tigerdb.md) when it is configured.

If live video stalls for three seconds, the last frame dims, the UI reports the outage, and mock driving/drop is stopped. It never silently replaces an interrupted live feed with a demo photo. Switch to demo photo explicitly to test without the Pi.

## Try the game flow

1. Wait for everyone to join and save interests. The roster on the left shows who is ready.
2. Choose a spotlight and optionally type a line of context, then select **Get three Muse prompts**, **From the conversation**, or the free **Use the question library**.
3. Pick a card with **Use this prompt**, or **Edit wording** first. This assigns it on the server, so the prompt appears on that player's phone at `/prompt` straight away, and Tina's badge is told to show the title.
4. The stage switches to driving. Select **Enable hand driving**, allow hand tracking and open both hands. Without an assigned prompt the wheels stay still and say so.
5. Stop and select **Arm capsule drop**, then pinch-and-hold **Pinch & hold to drop** for 0.8 seconds. Movement disarms dropping.
6. Record the outcome with **Mark completed** or **Pass this prompt**, then generate the next set. **Page preview** shows what the player sees.

**Stop** cancels pending local work, latches motion off, and sends zero wheel speeds plus a stop message when the relay connection is available. Open Camera settings to simulate video loss or request failures and inspect the local event log.

## ARKit hand motions

For setup, gestures, listener commands and troubleshooting, see the
[movement controls guide](docs/movement-controls.md).

In the immersive driving view, select **Enable hand driving** and allow hand tracking. Make a **definite fist in free space** and hold it still; no puck or gaze target is required for driving. A loose or half-cupped hand is deliberately not recognized. Keep both hands in the headset's tracking view, including the open hand when turning.

| Gesture | Direction | Left wheel | Right wheel |
| --- | --- | --- | --- |
| Both fists | Straight | 0.35 | 0.35 |
| Left fist, right hand open | Left turn | 0 | 0.35 |
| Right fist, left hand open | Right turn | 0.35 | 0 |
| Both hands open | Stop | 0 | 0 |

`left` and `right` in relay messages are physical wheel speeds, not hand labels. A left turn holds the left wheel still and advances the right wheel. The driving panel shows observed open/fist state and the requested wheel pair.

- After enabling, interruption, whole-hand loss, or a tracking gap of 250ms, open both hands for 150ms before starting. Brief scene inactivity pauses wheel output while preserving enablement; return to the app and open both hands to resume. Backgrounding still disables driving and disconnects.
- A new fist combination must settle for 300ms; opening both hands stops immediately. Recognition uses the stronger of the base and middle joint bends of each index, middle and ring finger, with agreement from at least two. Thumb and fingertip joints are unused. The bend score is `clamp(1 - cos(angle), 0...1)`; close at 0.72 and reopen at 0.25 to avoid jitter. This removes hand-size dependence and tolerates one unavailable or noisy finger. The close threshold and settle delay are deliberately strict: a relaxed or half-cupped hand used to read as a fist. Make a definite fist and hold it still.
- Samples from both hands must be newer than 250ms. If fewer than two fingers provide usable agreement, wheels stop immediately. Recovery within 250ms preserves a completed neutral reset, but the fist must settle again before resuming. Whole-hand loss, invalid numeric input or longer gaps require opening both hands again. Opening both hands at startup must be unambiguous; partly curled hands cannot satisfy the reset.
- Hand cards distinguish missing hands, insufficient finger-bend evidence, and stale samples. `[hands]` console messages report status changes, including whether wheels are paused for tracking recovery or require an open-hand reset.
- Finger agreement is categorical: two closed fingers agree even if one is bent more than the other. Hand cards show usable/estimated finger counts and base, middle and combined bend scores. On visionOS 26+, valid estimated finger joints are accepted within a tracked hand, following [Apple’s ARKit guidance](https://developer.apple.com/documentation/visionos-release-notes/visionos-26-release-notes); earlier systems retain the per-joint tracking requirement. `[hands:data]` logs each finger’s scores and estimated joint names once per second. Whole-hand loss and stale samples still stop driving. The startup log identifies the dual-bend recognizer and OS version.
- The **live camera mode sends actual wheel commands** through the relay to the Pi at up to 10Hz, with immediate updates on direction changes. It requires a connected Pi peer and fresh video. **Demo photo mode stays local.** Switching camera modes disables hand driving.
- **Enable hand driving** becomes a disabled confirmation after activation; use the separate **Stop** control to stop/disarm motion. Video loss, leaving the app, or exiting immersion also stops/disarms motion. Reconnection does not automatically resume motion. Use **Resume positioning** after a latched stop, then enable hand driving again.
- To drop: open both hands, select **Arm capsule drop**, then use the normal index-finger pinch-and-hold on **Pinch & hold to drop** for 0.8 seconds. Capsule dispensing is still simulated; the prompt itself was already assigned on the server when it was chosen.
- Hand driving also requires an assigned prompt. Without one the hand cards read `Wheels idle · no prompt is assigned yet`, and clearing the prompt on the server stops driving.

The ARKit provider requires a physical Vision Pro. Simulator checks validate gesture logic and the relay protocol but cannot validate physical hand recognition or motor direction. Physical hardware must enforce its own stale-command stop; an app cannot deliver a stop over a disconnected network. The supplied Pi client forwards commands to the ESP32 and does not itself implement a motor watchdog.


## Code

- `CenterpieceApp.swift`: full immersive scene, the five anchored panels, the motion gate, and the exit/recovery window.
- `GameMasterHUD.swift`: camera screen, the stage panel that switches between choosing and driving, connection settings, and the app lifecycle wiring.
- `DestinaClient.swift`: polling, mutations and the guards that keep a four-second poll from fighting a mutation.
- `DestinaModels.swift` / `DestinaConfig.swift`: decodable mirrors of the server's types, and bearer request building.
- `DestinaTheme.swift`: Destina's palette, typefaces, panels and buttons.
- `GameMasterStore.swift`: the stage machine, workbench input and the ported generation and approval rules.
- `RosterPanel.swift`, `PromptWorkbenchView.swift`, `PromptCardView.swift`, `CurrentPromptView.swift`, `DriveControlsView.swift`, `ConversationPanel.swift`, `TokensPanel.swift`: the panels.
- `RelayClient.swift`: relay configuration, JPEG receiver, serialized/coalesced wheel-command writer and the badge-screen message.
- `DemoSession.swift`: movement, arming and drop state, mirroring the server's assigned prompt.
- `RobotControls.swift`: observed hand-state HUD and native pinch-and-hold drop control.
- `HandMotionController.swift`: permission and ARKit provider lifecycle in the immersive space.
- `HandMotionInput.swift`: base/middle-bend fist recognition, tracking freshness and wheel mapping.
- `Scripts/build_relay_config.py`: allowlisted `.env` → generated app configuration.

See [the Game Master port](docs/gamemaster-port.md), [relay protocol and tests](docs/relay-integration.md) and [demo artwork provenance/prompt](docs/demo-artwork.md).
For the current headset hand-driving investigation and next test, see [hand-driving status](docs/hand-driving-status.md).

## Checks

Run with the Xcode toolchain selected (or set `DEVELOPER_DIR` to your installed Xcode's `Contents/Developer` directory):

```sh
xcrun swiftc -parse-as-library Centerpiece/DemoSession.swift Tests/DemoSessionChecks.swift -o /tmp/centerpiece-checks
/tmp/centerpiece-checks
xcrun swiftc -parse-as-library Centerpiece/DemoSession.swift Centerpiece/HandMotionInput.swift Tests/HandMotionChecks.swift -o /tmp/centerpiece-hand-checks
/tmp/centerpiece-hand-checks
xcrun swiftc -parse-as-library Centerpiece/RelayClient.swift Tests/RelayClientChecks.swift -o /tmp/centerpiece-relay-checks
python3 Tests/relay_fixture.py /tmp/centerpiece-relay-checks
xcrun swiftc -parse-as-library Centerpiece/DestinaModels.swift Centerpiece/DestinaConfig.swift Tests/DestinaClientChecks.swift -o /tmp/centerpiece-destina-checks
/tmp/centerpiece-destina-checks
```

The Destina checks cover decoding a captured server feed, the snapshot version
gate, the error envelope, the reward point cap, and that the Game Master key
never reaches the URL.

The WebSocket fixture checks the real Swift client over localhost, including auth header/room, JPEG decoding, malformed frames, stale video, reconnect, and cancellation. It is not a test of Render credentials, Pi streaming, or headset performance.

[Actual simulator screenshot of the compact layout](docs/ui-preview.png)

[Actual simulator screenshot of the immersive view](docs/immersive-preview.png)

The immersive build was compiled and launched in visionOS Simulator. Automatic entry, hiding the launcher, full-immersion rendering, and the visible exit control were confirmed. Physical headset interaction and the live Pi feed still need device validation.
