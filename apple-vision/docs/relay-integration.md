# Video and wheel relay contract and verification

Source of truth: sibling `relay/src/server.ts`, `relay/clients/visionpro/RelayClient.swift`, and `docs/ws-protocol.md` in the original hacktx_26 checkout. The client follows that existing contract; no new game/control message format is introduced.

- Endpoint: `wss://centerpiece-relay.onrender.com/ws`.
- Query: `role=visionpro&room=table&video=1` (room configurable in .env).
- Authentication: `Authorization: Bearer <RELAY_TOKEN>`. The server accepts this instead of a token query parameter.
- Text: `welcome` confirms connection; `presence` supplies `peers: [{role,id}]`. Other incoming messages remain unused by this client.
- Binary: one complete JPEG per WebSocket message, max 4 MiB. Malformed frames are rejected. Decode is off the main actor; only the latest decoded frame is retained. Images larger than 4096 pixels on either dimension are rejected and display decoding is bounded to 1920 pixels.
- Missing frames for three seconds mark the video stale and disable driving/drop. Old frames are visibly dimmed. No automatic switch to a demo photo when a live connection fails.
- Connection failures retry with exponential backoff (2–16 seconds). Explicit disconnect cancels receive/retry tasks and prevents old callbacks from changing state. Motion uses the existing `drive` and `stop` commands targeted to `pi`; game/dispense commands remain mocked.
- A transcript wire format is not present in the sibling contract. The transcript panel remains labeled Demo until one is agreed.

## Verification

The Postman simulation workflow was reviewed. Its documented HTTP request/response mocks do not exercise this binary WebSocket receive path, so `Tests/relay_fixture.py` provides a local WebSocket peer based on the existing relay contract. It does not replace the Swift client: the production `RelayClient` runs against it over real TCP, using the same URLSession receive/decode/reconnect path. The fixture checks the handshake and sends welcome, invalid payloads, a valid JPEG, a stall, and a disconnect. No cloud workspace or remote deployment is needed.

Compile and run on macOS with Xcode selected:

```sh
xcrun swiftc -parse-as-library Centerpiece/RelayClient.swift Tests/RelayClientChecks.swift -o /tmp/centerpiece-relay-checks
python3 Tests/relay_fixture.py /tmp/centerpiece-relay-checks
```

Local fixture success is not proof of deployed relay authentication or Pi video availability. Verify on the real headset with the configured token and a Pi publishing to the same room before relying on live video.

## Validation performed

- visionOS Simulator Debug build succeeded.
- The built app launched in visionOS Simulator; the compact selection layout was visually checked. Screenshot: `docs/ui-preview.png` (demo photo mode).
- The local TCP/WebSocket integration check passed bearer auth and subscription, welcome/presence, JPEG decode, malformed frame rejection, stale detection, reconnect, and explicit disconnect.
- The `.env` parser was checked with test values for quoted/literal tokens, allowlisted keys, URL validation, and missing configuration. No real credential was printed.
- Deployed Render authentication and live Pi video have not been verified; real hand controls still need headset testing.

## ARKit wheel output

The source contract is `../relay/clients/visionpro/RelayClient.swift` and the forwarding behavior in `../relay/clients/pi/pi_client.py`.

```json
{"type":"drive","to":"pi","left":0.35,"right":0.35}
```

Both pinches produce `(0.35, 0.35)`, left-hand-only `(0, 0.35)`, right-hand-only `(0.35, 0)`. These fields are wheel speeds. Directions assume positive wheel speeds mean forward, as in the supplied example.

Releasing, losing tracking, suspending control, or stopping queues a zero-speed drive followed by `{"type":"stop","to":"pi"}`. The single serial writer keeps one latest pending drive and gives Stop priority, discarding superseded movement rather than building a queue. Intent is sampled at 10Hz while moving, with immediate changes. Values are bounded to ±0.6 and non-finite inputs are rejected.

Motion starts only after explicit Enable hand driving, fresh tracking, an open-hand reset, live video, and a connected Pi peer. Demo photo mode sends no movement. Reconnect does not replay the previous command. Disconnect attempts a final zero/stop before closing the old socket with bounded cleanup; network failure cannot guarantee that the robot receives it. The firmware needs its own motion timeout.

The extended localhost fixture decodes masked client WebSocket frames and verifies actual outbound wheel fields/routing, a canceled 1000-intent burst, and the final stop before disconnect. `Tests/HandMotionChecks.swift` checks neutral reset, stable combinations, wheel direction, hysteresis, immediate release, tracking loss and invalid samples. These checks do not move the real robot.
