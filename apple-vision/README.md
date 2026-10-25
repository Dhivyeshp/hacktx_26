# Centerpiece · Vision Pro

A full immersive visionOS app with a compact overlay for the robot camera: photo avatars and player-specific questions on the left, a transcript on the right, and a clear central view. There is no bottom dock or drop-position marker. Selecting **Ready to drive** swaps the question panel for small driving/drop controls.

## Open the right project

Open `Centerpiece.xcodeproj` **from this checkout**, select the Centerpiece scheme and your paired Vision Pro, select your signing team, and Run. On first launch, the app automatically requests a full immersive space and hides its small launcher window after the space opens. This project requires visionOS 2 or newer and Xcode's visionOS support. The current Codex worktree is separate from the original checkout; changes here do not automatically appear in the other Xcode project window.

## Immersive presentation

The app starts in **full immersion**: passthrough and other apps are hidden. A large camera screen with the player/question/transcript overlay is positioned in front of the wearer. The screen is initialized at head height and remains still so you can look toward either side panel. The Pi feed is still a normal 2D camera image; this is a wide theater-style presentation, not 360-degree video.

- **Exit immersive** in the top bar returns to the small launcher window.
- **Enter immersive view** opens the space again. Video source settings and the selected player/question are retained.
- If opening is canceled or fails, the launcher explains what happened and offers retry.
- A system dismissal also restores the launcher and stops/disarms motion. It does not automatically reopen until you request it.
- Camera settings and the shared-page preview open as panels inside the immersive dashboard.

## Add the relay token

1. In this `apple-vision` directory, edit `.env`. If it is missing, copy `.env.example` to `.env`.
2. Set `RELAY_TOKEN` to the value from Render → centerpiece-relay → Environment. Do not put it in Swift source or chat.
3. Leave `RELAY_URL=wss://centerpiece-relay.onrender.com/ws` and `RELAY_ROOM=table` unless your relay uses a different endpoint/room.
4. Build and run again. Every build reads `.env` into the development app's generated `RelayConfig.plist`; `.env` itself is not copied into the bundle and is ignored by Git. Changing `.env` requires rebuilding/reinstalling.
5. With a token configured, the app automatically connects and waits for binary JPEGs from the Pi in the same room. Camera settings (top right) let you reconnect or switch to the demo photo.

The development app contains the token in its generated configuration so it can authenticate on the headset. Treat the built app as a credential-bearing artifact. Do not distribute it publicly with a shared relay token; use scoped short-lived credentials for distribution. The build script never sources `.env` as shell code or prints its values.

## Live and mocked features

**Live:** the WebSocket video connection, connection/presence state, JPEG decoding, stale-frame detection, reconnection, ARKit hand input on the headset, and wheel commands after enabling hand driving in live mode. The implementation follows the sibling relay's actual protocol, using its supported bearer header instead of placing the token in the URL. Video keeps its original aspect ratio.

**Mocked:** player identities/photos, questions, transcript, URL updates and dispensing. Movement is mocked only in demo photo mode. The transcript is explicitly labeled Demo because the shared contract does not yet define transcript messages. The app sends `drive` and `stop` commands to the Pi; it does not send a real dispense command yet. The illustrative photo is generated artwork, not a camera capture.

If live video stalls for three seconds, the last frame dims, the UI reports the outage, and mock driving/drop is stopped. It never silently replaces an interrupted live feed with a demo photo. Switch to demo photo explicitly to test without the Pi.

## Try the game flow

1. Select a circular player photo and a question.
2. Choose **Ready to drive**, then **Enable hand driving**. Allow hand tracking and open both hands.
3. Stop and select **Arm capsule drop**, then pinch-and-hold **Pinch & hold to drop** for 0.8 seconds. Movement disarms dropping.
4. The local demo assigns the shared page, waits for its simulated acknowledgment, then dispenses. **Page preview** shows the assigned question.
5. Finish the round before selecting another question. Every capsule would show the latest assigned question; the mock page retains that question until replaced.

**Stop** cancels pending local work, latches motion off, and sends zero wheel speeds plus a stop message when the relay connection is available. Open Camera settings to simulate video loss or request failures and inspect the local event log.

## ARKit hand motions

In the immersive driving view, select **Enable hand driving** and allow hand tracking. Use **thumb-to-middle-finger pinches in free space**; no puck or gaze target is required for driving. Keep both hands in the headset's tracking view, including the open hand when turning.

| Gesture | Direction | Left wheel | Right wheel |
| --- | --- | --- | --- |
| Both hands pinched | Straight | 0.35 | 0.35 |
| Left hand only pinched | Left turn | 0 | 0.35 |
| Right hand only pinched | Right turn | 0.35 | 0 |
| Both released | Stop | 0 | 0 |

`left` and `right` in relay messages are physical wheel speeds, not hand labels. A left turn holds the left wheel still and advances the right wheel. The driving panel shows observed open/pinched state and the requested wheel pair.

- After enabling, interruption, whole-hand loss, or a tracking gap of 250ms, open both hands for 150ms before starting. Brief scene inactivity pauses wheel output while preserving enablement; return to the app and open both hands to resume. Backgrounding still disables driving and disconnects.
- A new pinch combination must settle for 160ms; releasing both stops immediately. Pinch thresholds use 22mm to close and 35mm to release to avoid jitter.
- Samples from both hands must be newer than 250ms. Uncertain fingertips immediately stop/disarm driving. If valid fingertip tracking returns within 250ms of the last valid sample, a previously completed open-hand reset is preserved; the pinch must settle again for 160ms before movement resumes. Whole-hand loss, invalid numeric data, or longer gaps require opening both hands again. No wheel command is based on an uncertain fingertip position.
- Hand cards distinguish missing hands, uncertain thumb/middle fingertips, and stale samples. `[hands]` console messages report status changes, including whether wheels are paused for tracking recovery or require an open-hand reset.
- The **live camera mode sends actual wheel commands** through the relay to the Pi at up to 10Hz, with immediate updates on direction changes. It requires a connected Pi peer and fresh video. **Demo photo mode stays local.** Switching camera modes disables hand driving.
- **Enable hand driving** becomes a disabled confirmation after activation; use the separate **Stop** control to stop/disarm motion. Video loss, leaving the app, or exiting immersion also stops/disarms motion. Reconnection does not automatically resume motion. Use **Resume positioning** after a latched stop, then enable hand driving again.
- To drop: release both drive pinches, select **Arm capsule drop**, then use the normal index-finger pinch-and-hold on **Pinch & hold to drop** for 0.8 seconds. Capsule dispensing and URL assignment are still simulated.

The ARKit provider requires a physical Vision Pro. Simulator checks validate gesture logic and the relay protocol but cannot validate physical hand recognition or motor direction. Physical hardware must enforce its own stale-command stop; an app cannot deliver a stop over a disconnected network. The supplied Pi client forwards commands to the ESP32 and does not itself implement a motor watchdog.


## Code

- `DashboardView.swift`: compact glass panels, photo crops, live/demo background, transcript and controls.
- `RelayClient.swift`: relay configuration, JPEG receiver, and serialized/coalesced wheel-command writer.
- `DemoSession.swift`: local selection, movement and update-before-dispense state machine.
- `CenterpieceApp.swift`: full immersive scene, automatic launch, shared video settings, and exit/recovery window.
- `RobotControls.swift`: observed hand-state HUD and native pinch-and-hold drop control.
- `HandMotionController.swift`: permission and ARKit provider lifecycle in the immersive space.
- `HandMotionInput.swift`: stable pinch recognition, tracking freshness and wheel mapping.
- `Scripts/build_relay_config.py`: allowlisted `.env` → generated app configuration.

See [relay protocol and tests](docs/relay-integration.md) and [demo artwork provenance/prompt](docs/demo-artwork.md).

## Checks

Run with the Xcode toolchain selected (or set `DEVELOPER_DIR` to your installed Xcode's `Contents/Developer` directory):

```sh
xcrun swiftc -parse-as-library Centerpiece/DemoSession.swift Tests/DemoSessionChecks.swift -o /tmp/centerpiece-checks
/tmp/centerpiece-checks
xcrun swiftc -parse-as-library Centerpiece/DemoSession.swift Centerpiece/HandMotionInput.swift Tests/HandMotionChecks.swift -o /tmp/centerpiece-hand-checks
/tmp/centerpiece-hand-checks
xcrun swiftc -parse-as-library Centerpiece/RelayClient.swift Tests/RelayClientChecks.swift -o /tmp/centerpiece-relay-checks
python3 Tests/relay_fixture.py /tmp/centerpiece-relay-checks
```

The WebSocket fixture checks the real Swift client over localhost, including auth header/room, JPEG decoding, malformed frames, stale video, reconnect, and cancellation. It is not a test of Render credentials, Pi streaming, or headset performance.

[Actual simulator screenshot of the compact layout](docs/ui-preview.png)

[Actual simulator screenshot of the immersive view](docs/immersive-preview.png)

The immersive build was compiled and launched in visionOS Simulator. Automatic entry, hiding the launcher, full-immersion rendering, and the visible exit control were confirmed. Physical headset interaction and the live Pi feed still need device validation.
