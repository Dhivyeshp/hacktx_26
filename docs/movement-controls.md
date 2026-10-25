# Using Vision Pro movement controls

Make a firm fist with either hand to drive the robot through the relay. The Vision Pro recognizes
your hands and sends wheel speeds; the Pi receives those commands and forwards
them over serial when an ESP32 port is configured.

## 1. Prepare the app and Pi

- Install the latest `Centerpiece` app on a physical Vision Pro from
  `apple-vision/Centerpiece.xcodeproj`. Hand recognition needs the real headset.
- Configure the app's relay connection as described in the
  [app README](../README.md#add-the-relay-token).
- Use the same relay URL, token and room on the app, Pi and movement listener.
  The examples below use room `table`.
- Keep the Pi camera streaming. The app requires a connected Pi and a valid
  camera frame received within the last three seconds before sending movement.
  Demo photo mode does not send robot commands.

On the machine connected to the camera, run these commands from the repository:

```sh
cd relay/clients/pi
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

export RELAY_URL='wss://centerpiece-relay.onrender.com/ws'
export RELAY_TOKEN='<your relay token>'
export RELAY_ROOM='table'

# Camera and command reception only; no serial motor output.
ESP32_PORT='' .venv/bin/python pi_client.py
```

Reuse an existing `.venv` if it is already installed. To forward commands to
the motor controller, replace the last command with the correct serial port:

```sh
ESP32_PORT='/dev/ttyUSB0' .venv/bin/python pi_client.py
```

`/dev/ttyUSB0` is an example Linux port. The Pi client uses 115200 baud. The
motor controller must implement `drive` and `stop`; the checked-in badge-face
firmware handles the screen and ignores those movement commands.

## 2. Start the movement listener

In another terminal, run:

```sh
cd /Users/arnav/coding/hacktx_26/relay/clients/pi
RELAY_URL='wss://centerpiece-relay.onrender.com/ws' \
RELAY_TOKEN='<your relay token>' \
RELAY_ROOM='table' \
.venv/bin/python listen_for_movement.py
```

Adjust the repository path if running on another machine. The listener requires
`websockets>=13`, which is included in the Pi dependencies.

The listener prints movement changes and exact received JSON under
`WOULD SEND TO ROBOT`. It summarizes repeated messages once per second during
traffic. Add `--verbose` to the command to see every message, or `--duration 30`
to exit after 30 seconds.

The listener itself opens no camera or serial port and sends no robot commands.
It does not disable another Pi in the room: that Pi can still receive and
execute the same movement commands. A listener alone does not supply the live
camera feed needed by the app.

## 3. Enable movement on the headset

1. Enter the immersive view and select live Pi video. Confirm the picture updates.
2. Select a player and question, then choose **Ready to drive**.
3. Select **Enable hand driving** and allow hand-tracking permission.
4. Close any settings panel and keep both hands visible to the headset.
5. Open both hands until the panel says it is ready.
6. Make a firm fist with either or both hands and hold the pose steady for about a third of a second.

No gaze target or on-screen drag is needed while driving. Keep the other hand
visible and open when making a turn.

## 4. Gesture mapping

| Your hands | Action | Left wheel | Right wheel |
| --- | --- | ---: | ---: |
| Both fists | Forward | 0.35 | 0.35 |
| Left fist, right open | Turn left | 0 | 0.35 |
| Right fist, left open | Turn right | 0.35 | 0 |
| Both open | Stop | 0 | 0 |

Wheel values are normalized commands, not meters per second. Direction labels
assume positive wheel speeds move the wheels forward. Reverse is not mapped to
a hand gesture.

A new direction settles for about 300 ms before movement starts. Opening both
hands stops movement immediately in the app. Recognition is deliberately
strict: a loose or half-cupped hand does not count. Actual delivery still depends on
the network and motor controller.

Use the separate **Stop** button to disable hand driving. To recover from a
latched stop, choose **Resume positioning** when shown, enable hand driving
again, and open both hands. Reconnecting does not automatically resume movement.

## 5. What the Pi receives

Example forward message, including metadata added by the relay:

```json
{"type":"drive","to":"pi","left":0.35,"right":0.35,"from":"visionpro","fromId":"visionpro-example","ts":1792919421361}
```

Stopping sends one zero-speed drive followed by one explicit stop:

```json
{"type":"drive","to":"pi","left":0,"right":0,"from":"visionpro","fromId":"visionpro-example","ts":1792919421932}
{"type":"stop","to":"pi","from":"visionpro","fromId":"visionpro-example","ts":1792919421933}
```

- `type` selects the command; `left` and `right` are wheel speeds for `drive`.
- `to` routes the message to Pi-role clients in the room.
- `from` and `fromId` identify the sender; `ts` is the relay timestamp in Unix
  milliseconds. These example IDs and timestamps will differ in a real session.
- Values such as `0.3499999940395355` mean approximately `0.35`.

Held movement sends a heartbeat at about 10 Hz. Identical drive sends less than
100 ms apart are suppressed; direction changes and stops remain immediate.
The listener displays the zero-drive/stop pair as one logical stop by default;
`--verbose` shows both wire messages.

When `ESP32_PORT` is set, `pi_client.py` forwards the complete received JSON,
including metadata, as one newline-terminated serial message. Its `->esp32`
console line is also printed with serial disabled, so that line alone does not
prove a serial write or motor movement. Motor firmware needs its own timeout
for stale commands because a network failure can prevent delivery of a stop.

## 6. Reading the hand cards and troubleshooting

| What you see | Meaning / action |
| --- | --- |
| `Open` / `Fist` | The current recognized pose. Check both cards against your hands. |
| `base`, `mid`, `bend` | Base-joint, middle-joint and combined bend scores; these are not confidence percentages. |
| `estimated` | Fingers using estimated joint positions. On visionOS 26+, these can contribute while the whole hand remains tracked. |
| `Open both hands to get ready` | Hold both hands clearly open until ready, then make the gesture. |
| `Finger pose unavailable` / `Finger poses disagree` | There is insufficient usable finger evidence. Show both hands and reopen them. |
| `No fresh sample` / tracking lost | Movement stops. Bring both hands back into view and open them before retrying. |
| No Pi video / no Pi client | Check the camera-streaming Pi, relay settings and room. Presence alone does not prove video is arriving. |
| Listener only shows `presence` | The connection is visible, but no movement command has reached the listener. Check the headset's hand cards, status and wheel values. |
| Vision Pro disappears from presence | The headset connection left the room. Check whether the app was backgrounded or immersion exited; hand-tracking loss alone does not close the socket. |
| Commands arrive but wheels do not move | Check `ESP32_PORT`, serial connection and motor firmware. Listener output proves receipt by the listener, not motor actuation. |

Whole-hand loss or a tracking gap of 250 ms requires opening both hands again.
Shorter finger-pose dropouts also stop the wheels, but can recover after a stable
gesture without repeating the open-hand reset. Leaving the app, opening a
blocking panel, arming a drop or losing live video can also pause movement.

For a recognition problem, capture the card values and `[hands:data]` lines from
the Xcode console while hands are open and while fists are held.

See [investigation history](hand-driving-status.md) for the fixes and headset
test results, and [relay contract and checks](relay-integration.md) for technical
verification details.
