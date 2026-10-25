# Centerpiece · Vision Pro

A compact native visionOS overlay for the robot camera: photo avatars and player-specific questions on the left, a transcript on the right, and a clear central view. There is no bottom dock or drop-position marker. Selecting **Ready to drive** swaps the question panel for small driving/drop controls.

## Open the right project

Open `Centerpiece.xcodeproj` **from this checkout**, select the Centerpiece scheme and your paired Vision Pro, select your signing team, and Run. This project requires visionOS 2 or newer and Xcode's visionOS support. The current Codex worktree is separate from the original checkout; changes here do not automatically appear in the other Xcode project window.

## Add the relay token

1. In this `apple-vision` directory, edit `.env`. If it is missing, copy `.env.example` to `.env`.
2. Set `RELAY_TOKEN` to the value from Render → centerpiece-relay → Environment. Do not put it in Swift source or chat.
3. Leave `RELAY_URL=wss://centerpiece-relay.onrender.com/ws` and `RELAY_ROOM=table` unless your relay uses a different endpoint/room.
4. Build and run again. Every build reads `.env` into the development app's generated `RelayConfig.plist`; `.env` itself is not copied into the bundle and is ignored by Git. Changing `.env` requires rebuilding/reinstalling.
5. With a token configured, the app automatically connects and waits for binary JPEGs from the Pi in the same room. Camera settings (top right) let you reconnect or switch to the demo photo.

The development app contains the token in its generated configuration so it can authenticate on the headset. Treat the built app as a credential-bearing artifact. Do not distribute it publicly with a shared relay token; use scoped short-lived credentials for distribution. The build script never sources `.env` as shell code or prints its values.

## Live and mocked features

**Live:** the receive-only WebSocket video connection, connection/presence state, JPEG decoding, stale-frame detection, and reconnection. The implementation follows the sibling relay's actual protocol, using its supported bearer header instead of placing the token in the URL. Video keeps its original aspect ratio.

**Mocked:** player identities/photos, questions, transcript, movement, URL updates and dispensing. The transcript is explicitly labeled Demo because the shared contract does not yet define transcript messages. The app never sends robot commands. The illustrative photo is generated artwork, not a camera capture.

If live video stalls for three seconds, the last frame dims, the UI reports the outage, and mock driving/drop is stopped. It never silently replaces an interrupted live feed with a demo photo. Switch to demo photo explicitly to test without the Pi.

## Try the game flow

1. Select a circular player photo and a question.
2. Choose **Ready to drive**. Use the pad: hold and drag up to move, sideways to turn, release to stop.
3. Stop and select **Arm capsule drop**, then pinch-and-hold **Pinch & hold to drop** for 0.8 seconds. Movement disarms dropping.
4. The local demo assigns the shared page, waits for its simulated acknowledgment, then dispenses. **Page preview** shows the assigned question.
5. Finish the round before selecting another question. Every capsule would show the latest assigned question; the mock page retains that question until replaced.

**Stop** cancels pending local work and latches motion off. It does not control a real robot. Open Camera settings to simulate video loss or request failures and inspect the local event log.

## Hand gestures

Driving uses visionOS’s built-in system gestures in the regular app window. No immersive space or hand-tracking permission is required.

- Look at the mint puck, pinch, and drag upward to drive forward. Drag sideways to turn, or diagonally to do both. Either hand works.
- Hold the pinch to maintain the command; release to stop. A small center dead zone prevents unintended drift. Wheel commands are bounded to 60 percent.
- A system gesture cancellation, leaving driving mode, video loss, or opening a sheet stops movement. A new pinch is needed to drive again after interruption.
- Release the driving pinch and select **Arm capsule drop**. Look at **Pinch & hold to drop** and hold for **0.8 seconds**. The circular indicator shows progress; releasing early cancels. The recognized hold triggers one simulated drop.
- Starting another driving gesture disarms dropping. A hold started under an older arming cannot trigger a drop after rearming.
- **Stop** latches motion off until you finish/reset the round. Local input that stops updating times out after 250ms.

These are SwiftUI `DragGesture` and `LongPressGesture` interactions, using the system’s gaze targeting, pinch recognition and cancellation. `@GestureState` handles both release and cancellation. The implementation and state-machine checks do not replace ergonomic testing on the actual headset. The same pad can be dragged with the simulator pointer.


## Code

- `DashboardView.swift`: compact glass panels, photo crops, live/demo background, transcript and controls.
- `RelayClient.swift`: relay configuration and receive-only WebSocket client.
- `DemoSession.swift`: local selection, movement and update-before-dispense state machine.
- `CenterpieceApp.swift`: shared session and regular app window.
- `RobotControls.swift`: native pinch-and-drag puck and pinch-and-hold drop control.
- `Scripts/build_relay_config.py`: allowlisted `.env` → generated app configuration.

See [relay protocol and tests](docs/relay-integration.md) and [demo artwork provenance/prompt](docs/demo-artwork.md).

## Checks

Run with the Xcode toolchain selected (or set `DEVELOPER_DIR` to your installed Xcode's `Contents/Developer` directory):

```sh
xcrun swiftc -parse-as-library Centerpiece/DemoSession.swift Tests/DemoSessionChecks.swift -o /tmp/centerpiece-checks
/tmp/centerpiece-checks
xcrun swiftc -parse-as-library Centerpiece/RelayClient.swift Tests/RelayClientChecks.swift -o /tmp/centerpiece-relay-checks
python3 Tests/relay_fixture.py /tmp/centerpiece-relay-checks
```

The WebSocket fixture checks the real Swift client over localhost, including auth header/room, JPEG decoding, malformed frames, stale video, reconnect, and cancellation. It is not a test of Render credentials, Pi streaming, or headset performance.

[Actual simulator screenshot of the compact layout](docs/ui-preview.png)
