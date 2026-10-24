# Relay

One websocket that connects the Raspberry Pi (robot + USB webcam), the Vision Pro Game Master app, the game hub, and dashboards. It has no game logic. It only routes messages within a room.

```
wss://<host>/ws?room=table&role=<pi|visionpro|hub|ai|dashboard>&token=<RELAY_TOKEN>
```

**Deployed:** `wss://centerpiece-relay.onrender.com/ws` (health: `https://centerpiece-relay.onrender.com/healthz`). Get `RELAY_TOKEN` from the Render dashboard → centerpiece-relay → Environment.

- **Text frames** are JSON: `{ "type": "...", ...payload }`. They go to everyone else in the room. Add `"to": "pi"` or `"to": ["pi","hub"]` to target specific roles. The relay adds `from`, `fromId` and `ts`.
- **Binary frames** are JPEG camera frames, and only the `pi` may send them. They go to clients with video enabled (the default for `visionpro` and `dashboard`; others add `&video=1`). Frames are dropped for a client whose socket falls behind. JSON is never dropped.
- `{ "type": "ping", "t": 123 }` gets back `{ "type": "pong", "t": 123, "serverTs": ... }`, which is useful for measuring latency.
- On join and leave, everyone in the room receives `{ "type": "presence", "peers": [{ "id", "role" }] }`.
- `GET /healthz` shows rooms, connected roles and counters.

The message types the game uses are listed in `docs/ws-protocol.md`.

## Run locally

```bash
cd relay
npm install
npm run dev                        # ws://localhost:8080/ws (no token when RELAY_TOKEN is unset)
npm test
npm run fake-pi                    # fake telemetry and frames, in a second terminal
```

The Pi and the Vision Pro both reach the relay from inside the venue, so a laptop on the same Wi-Fi works as the relay too. Point both clients at `ws://<laptop-ip>:8080/ws`. This is the lowest-latency setup and works if venue internet is bad.

## Clients

- **Pi:** `clients/pi/pi_client.py`. Install with `pip install -r clients/pi/requirements.txt`, then run `RELAY_URL=wss://<host>/ws RELAY_TOKEN=... ESP32_PORT=/dev/ttyUSB0 python pi_client.py`. It streams the webcam at about 12 fps (640 px, JPEG quality 60), sends telemetry at 10 Hz, and writes `drive|stop|deliver|dispense|screen` commands to the ESP32 as JSON lines.
- **Vision Pro:** `clients/visionpro/RelayClient.swift`. Add it to the app target. It exposes `latestFrame: UIImage?`, `lastTelemetry` and `send([...])`.

## Deploy to Render

`render.yaml` at the repo root is a Blueprint.

1. In the Render dashboard, choose **New > Blueprint**, connect GitHub and pick this repo. Render reads `render.yaml` and creates `centerpiece-relay`.
2. Render generates `RELAY_TOKEN`. Copy it from the service's **Environment** tab and share it with whoever runs the Pi and Vision Pro clients.
3. The URL is `wss://centerpiece-relay.onrender.com/ws` (Render shows the exact hostname).
4. Check it with `curl https://<host>/healthz`, then `RELAY_URL=wss://<host>/ws RELAY_TOKEN=... npm run fake-pi`.

Every push to the deployed branch redeploys automatically. Render's free plan sleeps after 15 minutes idle and takes about a minute to wake up, so upgrade the service to **Starter** before filming the demo.
