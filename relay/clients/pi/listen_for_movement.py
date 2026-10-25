"""Print the robot commands received from the relay, without opening hardware.

Uses the same role and JSON-line payload as pi_client.py. Requires websockets>=13.
Configure RELAY_URL, RELAY_TOKEN and RELAY_ROOM just like the Pi client.
"""

import argparse
import asyncio
import json
import math
import os
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

try:
    from websockets.asyncio.client import connect
except ImportError:
    raise SystemExit(
        'Missing websockets. Run .venv/bin/python listen_for_movement.py '
        'or install with: python3 -m pip install "websockets>=13"'
    ) from None


ESP32_COMMANDS = {"drive", "stop", "deliver", "dispense", "screen"}


def connection_settings():
    parts = urlsplit(os.environ.get("RELAY_URL", "ws://localhost:8080/ws"))
    if parts.scheme not in {"ws", "wss"} or not parts.hostname:
        raise ValueError("RELAY_URL must be a ws:// or wss:// URL")
    params = dict(parse_qsl(parts.query))
    token = os.environ.get("RELAY_TOKEN") or params.pop("token", "")
    params.pop("token", None)
    room = os.environ.get("RELAY_ROOM", params.get("room", "table"))
    # A dashboard would miss commands addressed to pi. Use a unique ID so this
    # observer doesn't impersonate the identity of an existing robot.
    params.update(role="pi", room=room, id=f"movement-listener-{uuid4().hex[:8]}", video="0")
    url = urlunsplit(parts._replace(query=urlencode(params), fragment=""))
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return url, headers, room


def describe(msg):
    if msg["type"] != "drive":
        return "STOP" if msg["type"] == "stop" else msg["type"].upper()
    left, right = msg.get("left"), msg.get("right")
    if not all(type(v) in (int, float) and math.isfinite(v) and -1 <= v <= 1
               for v in (left, right)):
        return "INVALID DRIVE (expected finite left/right wheel speeds in -1..1)"
    if left == right:
        direction = "STOP" if left == 0 else "FORWARD" if left > 0 else "REVERSE"
    else:
        direction = "TURN LEFT" if right > left else "TURN RIGHT"
    return f"{direction}  left={left:.3f} right={right:.3f}"


def log(message):
    print(f"[{datetime.now().astimezone().isoformat(timespec='milliseconds')}] {message}", flush=True)


def handle_message(raw):
    if isinstance(raw, bytes):
        return False
    try:
        msg = json.loads(raw)
    except ValueError:
        log("Ignoring malformed JSON")
        return False
    if not isinstance(msg, dict):
        return False
    kind = msg.get("type")
    if kind in ESP32_COMMANDS:
        log(f"{msg.get('from', 'unknown')}/{msg.get('fromId', '?')} -> {describe(msg)}")
        # Match pi_client.py's serial payload, including relay metadata. This
        # listener never imports serial, opens a camera, or sends app messages.
        print("WOULD SEND TO ROBOT: " + json.dumps(msg), flush=True)
        return True
    if kind in {"welcome", "presence"}:
        peers = msg.get("peers", [])
        log(f"{kind}: " + ", ".join(f"{p.get('role')}/{p.get('id')}" for p in peers))
        if not any(p.get("role") == "visionpro" for p in peers):
            log("No Vision Pro in this room yet; waiting for it to connect.")
    elif kind == "error":
        log("Relay reported an error message.")
    return False


async def listen(url, headers, room):
    backoff = 1
    count = 0
    log(f"Listening in room {room!r} as pi; hardware output disabled. Ctrl-C to exit.")
    log("Hand driving requires live Pi camera video, Enable hand driving, and an open-hand reset.")
    try:
        while True:
            try:
                async with connect(url, additional_headers=headers, max_size=4 * 1024 * 1024,
                                   ping_interval=20, open_timeout=60) as ws:
                    log("Connected to relay; waiting for drive/stop commands.")
                    backoff = 1
                    while True:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=15)
                        except asyncio.TimeoutError:
                            log(f"Still connected; {count} robot commands received. Waiting for hand movement.")
                            continue
                        count += handle_message(raw)
            except Exception as exc:
                # Exception text may contain URLs/credentials; report only type/status.
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (400, 401, 403, 404):
                    log(f"Connection rejected (HTTP {status}); check RELAY_URL and RELAY_TOKEN.")
                    return 1
                log(f"Connection lost ({type(exc).__name__}); retrying in {backoff}s.")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 15)
    finally:
        log(f"Listener finished: {count} robot commands received; no commands sent by this listener.")


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=float, default=0,
                        help="Exit after this many seconds; default listens until Ctrl-C")
    args = parser.parse_args()
    if not math.isfinite(args.duration) or args.duration < 0:
        parser.error("--duration must be a finite nonnegative number")
    try:
        settings = connection_settings()
    except ValueError as exc:
        parser.error(str(exc))
    if args.duration:
        try:
            return await asyncio.wait_for(listen(*settings), timeout=args.duration)
        except asyncio.TimeoutError:
            return 0
    return await listen(*settings)


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        pass
