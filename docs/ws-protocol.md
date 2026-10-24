# Websocket message contract

Everything goes through the relay (`relay/`): `wss://<relay>/ws?room=table&role=<role>&token=<RELAY_TOKEN>`.
Text frames are JSON with a `type`. The relay adds `from` (the sender's role), `fromId` and `ts` (ms). Add `"to": "<role>"` to send to one role only.

Roles: `pi` (robot + webcam), `visionpro` (Game Master), `hub` (game server / AI on the 5070 Ti), `ai`, `dashboard`.

## Pi → everyone

| type | payload | rate |
| --- | --- | --- |
| *(binary)* | JPEG frame from the USB webcam | ~12 fps; only to `visionpro`/`dashboard` and clients that connected with `&video=1` |
| `telemetry` | `robot_id, x, y, heading, speed, battery_v, motor_l, motor_r, state ("idle"\|"navigating"\|"dispensing"), capsules_left` | 10 Hz |
| `detections` | `people: [{ track_id, bbox: [x,y,w,h] (0..1), confidence, distance_m }]` | 2–5 Hz |
| `arrived` | `target_player_id` | once per delivery |
| `dispensed` | `target_player_id` | once per delivery |

## Vision Pro → Pi (`"to": "pi"`)

| type | payload |
| --- | --- |
| `drive` | `left, right` (-1..1 wheel speeds): manual / hand-tracked driving |
| `stop` | none |
| `deliver` | `target_player_id, track_id?`: drive to that person |
| `dispense` | none: drop a capsule now |
| `screen` | `text, face?`: what the ESP32 screen shows |

## Vision Pro ↔ hub

| type | direction | payload |
| --- | --- | --- |
| `options` | hub → visionpro | `round_no, options: [{ rank, challenge, target_player_id, reason, prompt }]` |
| `gm_choice` | visionpro → hub | `round_no, picked_rank, challenge, target_player_id, prompt, edited` |
| `round_state` | hub → all | `round_no, phase ("mingle"\|"recommend"\|"deliver"\|"play"\|"payout"), ends_at` |
| `payout` | hub → all | `round_no, awards: [{ player_id, points, signature }], keepsake?: { mint, image }` |

## Utility

- `{ "type": "ping", "t": <ms> }` gets back `{ "type": "pong", "t", "serverTs" }`.
- `presence` is broadcast whenever someone joins or leaves: `{ peers: [{ id, role }] }`.
