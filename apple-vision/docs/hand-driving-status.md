# Vision Pro hand driving: status and troubleshooting

Last updated: October 25, 2026. This is a handoff for the current investigation,
including what has been tested and what still needs a physical headset check.

## Goal and current status

Use free-space hand gestures on the Vision Pro to send wheel commands through
the relay to the Raspberry Pi, and see exactly what the Pi would forward to the
robot. The relay path has received real movement commands from the headset. The
user reports that the dual-bend/estimated-joint correction works substantially
better on the headset. The 4:10 AM listener log shows real forward, left-turn
and stop commands. Sensitivity remains noticeable but acceptable to the user.
Actual motor actuation is still unverified. The next change removes redundant
wire sends and condenses repeated listener output; it has local validation only.

## How the pieces connect

```text
Vision Pro hand tracking -> gesture and wheel logic -> relay -> Pi -> ESP32
                                              \-> movement listener (prints)
Pi camera -> relay -> Vision Pro live video
```

The Vision app connects to the relay as `visionpro` in room `table`. It sends
JSON commands addressed to `pi`. The relay adds the sender, sender ID and
timestamp, and delivers the message to matching Pi-role clients. The normal
Pi client forwards supported commands as JSON lines to the ESP32 if a serial
port is configured. The listener is another Pi-role client that prints those
messages; it opens no camera or serial port and does not drive the robot.

The listener shows messages received by the listener. Its output alone does
not establish that the real Pi wrote to serial, the ESP32 accepted the command,
or the wheels moved. A real Pi connected in the same room can receive and
execute the same commands while the listener is running.

The intended current controls are:

| Hand pose | Action | Left wheel | Right wheel |
| --- | --- | --- | --- |
| Both fists | Forward | 0.35 | 0.35 |
| Left fist, right open | Turn left | 0 | 0.35 |
| Right fist, left open | Turn right | 0.35 | 0 |
| Both hands open | Stop | 0 | 0 |

These are wheel speeds, not hand positions. Direction names assume positive
wheel speed moves that wheel forward; physical motor direction still needs
confirmation. An active movement stop queues a zero-speed `drive`, then `stop`.
Holding a gesture produces repeated `drive` messages. Values such as
`0.3499999940395355` are floating-point representations of approximately 0.35.

## What happened during testing

1. The original command referred to `listen_for_movement.py`, which was missing.
   We added it under `relay/clients/pi/`. The existing Pi `.venv` contains its
   `websockets` dependency; the Mac's default Python did not.
2. A local test through the actual relay checked the listener's movement labels,
   zero and stop messages, targeting and metadata. The deployed relay also
   accepted the provided token and listener connection. These checks do not
   prove robot actuation.
3. Presence logs showed the listener, `bot-1`, and the headset joining the
   same room. Later, the headset left the room. Presence identifies connections;
   it does not explain why a peer disconnected.
4. In the first recording, the app had hand driving enabled, but either hand
   could report untracked while visible. At one point the right hand was
   `Pinched`, the left was untracked, and wheel values were zero. The original
   thumb-to-middle-finger control required both hands and fingertip joints to
   be tracked, plus an open-hand reset after tracking loss.
5. We adjusted brief tracking recovery and added tracking diagnostics. A real
   subsequent listener log showed left-turn commands, followed by intermittent
   zero/stop commands and resumed left turns. This establishes that the prior
   pinch implementation sent commands through the deployed relay to the
   listener; it does not prove the Pi or motors executed them. The stop/start
   pattern by itself does not identify whether release, tracking or another
   control gate caused each interruption.
6. At the user's preference, we changed the free-space input to loose fists,
   keeping the same wheel mapping. The next recording showed both fists held
   while the cards said `Need two clear finger bends`, and the wheels remained
   zero. That message combined missing joints and disagreement, so the video
   did not establish which condition occurred.
7. We fixed one concrete two-finger agreement bug: two fingers classified as
   closed were rejected if their numeric bend scores differed too much. The
   HUD now reports usable fingers and bend score, distinguishes partial curl,
   and separates missing joints from disagreeing poses. Xcode `[hands:data]`
   logs included per-finger curl and untracked joint names. The next headset
   test established that this agreement fix alone was insufficient.
8. Reviewed `Screen Recording 2026-10-25 at 3.57.07 AM.mov`. Around 35 seconds,
   the right fist was visible while the right card read open / 7% bend. Around
   45 and 55 seconds, finger tracking became unavailable. This establishes
   misclassification and rejected samples, but video alone does not reveal
   the underlying joint coordinates or the headset's OS version.
9. Found relevant guidance in Apple's [visionOS 26 release notes](https://developer.apple.com/documentation/visionos-release-notes/visionos-26-release-notes),
   ARKit issue 152100522: per-joint `isTracked` is more sensitive to occlusion;
   plausible joint transforms remain available, and custom gestures should
   not require every joint to have this flag. Our previous filtering rejected
   these estimates. On visionOS 26+, the recognizer now accepts valid estimated
   finger geometry from a currently tracked hand. Earlier OS versions retain
   the joint-flag requirement. Whole-hand tracking and freshness checks remain.
10. The previous geometry measured only the base knuckle. The recognizer now
    also measures the middle bend, using the stronger of the two per finger.
    This addresses fingers curling mainly at the middle joint; it is a geometry
    improvement, not proof that this was the only cause of the low video score.
    Thresholds remain 0.55 to close and 0.25 to reopen. The HUD shows base/middle
    scores and estimated-finger counts. The subsequent headset run improved
    recognition, as confirmed by the user and the 4:10 AM movement log.
11. The 4:10 AM log showed regular held-motion heartbeats and occasional
    near-simultaneous duplicate drives/stop pairs. The timer and change callbacks
    both call the sender; the old writer could also queue another stop while
    awaiting a stop send. Identical drives are now limited to one per 100 ms,
    while changed directions and stops remain immediate. A pending/in-flight
    stop is coalesced. Each stop still sends one zero-drive plus one explicit
    stop for compatibility. No gesture thresholds changed in this iteration.
12. The listener now prints movement changes immediately, summarizes hidden
    repeats once per second during traffic, and offers `--verbose` to print
    every received command. Counts include hidden messages. This changes only
    the listener display, not forwarding by the real Pi client.

## Apple sample reviewed

Local reference: `/Users/arnav/Downloads/DetectingHandPosesWithVision`.
`CameraViewController.swift` runs `VNDetectHumanHandPoseRequest` on camera frames,
selects one hand, and checks thumb/index tip confidence above 0.3.
`HandGestureProcessor.swift` recognizes a pinch using screen-space distance
(40 points by default), requiring three consecutive observations before
committing to pinched/apart states. It is a drawing sample, not a fist detector.

The useful design is accumulating evidence before committing to a gesture.
Our existing 160 ms stable-start gate serves that purpose for wheel commands.
The sample's 2D distance, camera setup and drawing-history buffering are not
drop-in replacements for ARKit's 3D hand skeleton. We retained ARKit and did
not copy the drawing app's code or delayed reset behavior into robot control.

## Current recognition and control gates

The fist recognizer measures base and middle bends for the index, middle and
ring fingers. Each angle scores `clamp(1 - cos(angle), 0...1)`; the finger score
is the maximum of its two bends. At least two usable fingers must agree. Joint
positions must be finite and adjacent bones longer than 1 mm and shorter than
12 cm. On visionOS 26+, estimated joints are accepted only within a current,
tracked hand anchor; on older systems, all contributing joints must also be
reported tracked. Estimates can be inaccurate and require physical validation.
A new direction must remain stable for 160 ms, and opening both hands stops
an active movement.

Driving also requires all of the following:

- The app is in its active immersive view, live relay video is enabled, and
  the relay is connected to a `pi` peer in the same room.
- A valid Pi camera frame has arrived in the last three seconds. A Pi presence
  message alone does not prove video is arriving. The listener does not stream
  video; the repository's fake Pi placeholder bytes are not decodable video.
- A player and question have been selected, **Ready to drive** chosen, and
  **Enable hand driving** selected. No blocking panel or armed drop is active.
- Both hands have fresh usable samples. After enabling or a latched interruption,
  both hands must be held clearly open for 150 ms to complete the reset.

Insufficient finger evidence stops movement. If samples return within 250 ms
of the last valid sample, the previously completed reset is retained, but a
new direction must settle again. Whole-hand loss or a longer gap requires
opening both hands again. An inactive scene pauses motion; backgrounding or
leaving the immersive view can also disconnect the relay. A tracking dropout
by itself does not close the WebSocket.

## Run the listener

```sh
cd /Users/arnav/coding/hacktx_26/relay/clients/pi
RELAY_URL=wss://centerpiece-relay.onrender.com/ws \
RELAY_TOKEN='<your relay token>' \
RELAY_ROOM=table \
.venv/bin/python listen_for_movement.py
```

If the virtual environment has not been set up on this machine, create it with
`python3 -m venv .venv` and run `.venv/bin/python -m pip install 'websockets>=13'`.
Use `--duration 30` for a bounded connection check. Obtain the token from the
relay's configuration; do not commit it into this document or source code.

`presence` lines show which roles are connected. `WOULD SEND TO ROBOT` shows
the JSON received by the listener, including relay metadata. It does not show
raw hand poses, and it does not attest to delivery to the physical robot.
The default display condenses repeated movement and the zero-drive/stop pair;
add `--verbose` to see every raw message. Restart the listener to use this change.

## Next headset check

1. Open `apple-vision/Centerpiece.xcodeproj` from this checkout, select the
   physical Vision Pro and Run to install the latest build. Keep live Pi camera
   streaming and the listener running in the same room.
2. Select a player and question, choose **Ready to drive**, enable hand
   driving, and close any settings panel. Open both hands until the panel says
   it is ready. Confirm live video is updating.
3. Hold both hands open, then hold each fist and both fists. Check the hand
   cards, wheel values and listener output. Open both hands to stop.
4. Confirm the cards now show `base`, `mid` and an `estimated` count. The startup
   console line says `Dual-bend recognizer` and includes OS version and whether
   estimated joints are enabled. If a fist fails, capture a few `[hands:data]` lines from the Xcode console
   for open hands and for fists, along with the card's usable-finger count,
   base/middle/combined bend percentages and status. The logs are produced once per second while
   hand driving is active. This distinguishes estimated joints from low or
   conflicting bend scores and supports an evidence-based next change.
5. Separately verify the real Pi's `->esp32` output and actual wheel direction
   when hardware is ready. The Pi client forwards commands only if its serial
   port is configured.

## Verification and limitations

- The hand-input regression checks cover wheel mapping, gesture stability,
  opening to stop, brief and sustained tracking loss, interrupted control,
  invalid inputs, finger geometry and the corrected two-finger agreement case.
  Added cases cover a straight base with a curled middle joint, estimated-joint
  acceptance on the new policy, rejection on the old policy, open estimated
  fingers, invalid geometry, and whole-hand/stale stops despite estimated poses.
- The latest visionOS Simulator Debug build succeeded. A simulator build and
  synthetic input tests cannot establish physical ARKit gesture reliability.
- The deployed relay received forward, left-turn and stop commands from the
  revised fist recognizer in the user's 4:10 AM test. Actual robot actuation
  is unverified. The checked-in badge-face firmware ignores drive/stop; motor
  firmware must implement those commands separately.
- The local WebSocket fixture passed duplicate suppression, retained heartbeat,
  direction changes, restart after stop, exactly one zero/stop pair per stop,
  canceled bursts and disconnect stop. Listener tests passed condensed output,
  sender separation, verbose payload preservation and invalid-message visibility.
- A WebSocket stop can be lost during a network failure. The repository's Pi
  client forwards commands but does not implement a motor watchdog; physical
  firmware needs an independent stale-command stop.

Relevant implementation: `Centerpiece/HandMotionController.swift`,
`Centerpiece/HandMotionInput.swift`, `Centerpiece/RobotControls.swift`,
`Centerpiece/RelayClient.swift`, `relay/clients/pi/pi_client.py`, and
`relay/clients/pi/listen_for_movement.py`. See `docs/relay-integration.md` for
the relay contract and existing fixture checks.
