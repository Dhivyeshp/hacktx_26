"""Direct motor-control websocket server for the Raspberry Pi.

visionOS app -> ws://<PI_IP>:8765 -> gpiozero.Motor -> L293D -> wheels.
Wiring and safety rules: hardware-spec.md. LAN only, never expose publicly.

    pip install -r requirements.txt
    MOTOR_TOKEN=secret python motor_server.py

Protocol (JSON text frames, send ~20/s while driving):
    {"type":"drive","left":0.5,"right":0.5}   wheel speeds -1..1
    {"type":"stop"}
    {"type":"heartbeat"}
"""

import asyncio
import json
import math
import os
import time
from http import HTTPStatus
from urllib.parse import parse_qs, urlsplit

from websockets.asyncio.server import serve

HOST = os.environ.get("MOTOR_HOST", "0.0.0.0")
PORT = int(os.environ.get("MOTOR_PORT", "8765"))
TOKEN = os.environ.get("MOTOR_TOKEN", "")
MAX_SPEED = float(os.environ.get("MAX_SPEED", "0.5"))  # initial PWM cap
WATCHDOG_S = 0.3

# BCM pins (hardware-spec.md)
LEFT_PINS = {"forward": 17, "backward": 27, "enable": 18}
RIGHT_PINS = {"forward": 22, "backward": 23, "enable": 13}


def clamp(value: float, limit: float = 1.0) -> float:
    return max(-limit, min(limit, value))


def parse_command(raw: str) -> dict | None:
    """Return a validated command or None if malformed."""
    try:
        msg = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(msg, dict):
        return None
    kind = msg.get("type")
    if kind in ("stop", "heartbeat"):
        return {"type": kind}
    if kind == "drive":
        speeds = []
        for key in ("left", "right"):
            v = msg.get(key)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                return None
            speeds.append(float(v))
        return {"type": "drive", "left": speeds[0], "right": speeds[1]}
    return None


class Drivetrain:
    def __init__(self):
        from gpiozero import Motor

        self.left = Motor(**LEFT_PINS, pwm=True)
        self.right = Motor(**RIGHT_PINS, pwm=True)
        self.stop()

    def drive(self, left: float, right: float) -> None:
        self.left.value = clamp(left, MAX_SPEED)
        self.right.value = clamp(right, MAX_SPEED)

    def stop(self) -> None:
        self.left.stop()
        self.right.stop()

    def close(self) -> None:
        self.stop()
        self.left.close()
        self.right.close()


class MotorServer:
    def __init__(self, drivetrain):
        self.drivetrain = drivetrain
        self.active = None
        self.last_cmd = time.monotonic()

    def authorize(self, connection, request):
        query = parse_qs(urlsplit(request.path).query)
        if TOKEN and query.get("token", [""])[0] != TOKEN:
            return connection.respond(HTTPStatus.UNAUTHORIZED, "unauthorized\n")
        if self.active is not None:
            return connection.respond(HTTPStatus.CONFLICT, "controller already connected\n")
        return None

    async def handler(self, ws):
        self.active = ws
        self.last_cmd = time.monotonic()
        print("controller connected")
        try:
            async for raw in ws:
                if isinstance(raw, bytes):
                    continue
                cmd = parse_command(raw)
                if cmd is None:
                    await ws.send(json.dumps({"type": "error", "error": "malformed command"}))
                    continue
                self.last_cmd = time.monotonic()
                if cmd["type"] == "drive":
                    self.drivetrain.drive(cmd["left"], cmd["right"])
                elif cmd["type"] == "stop":
                    self.drivetrain.stop()
        finally:
            self.drivetrain.stop()
            self.active = None
            print("controller disconnected; motors stopped")

    async def watchdog(self):
        while True:
            if time.monotonic() - self.last_cmd > WATCHDOG_S:
                self.drivetrain.stop()
            await asyncio.sleep(0.05)


async def main():
    if not TOKEN:
        print("WARNING: MOTOR_TOKEN not set; any LAN client can drive the car")
    drivetrain = Drivetrain()
    server = MotorServer(drivetrain)
    watchdog = asyncio.create_task(server.watchdog())
    try:
        async with serve(server.handler, HOST, PORT, process_request=server.authorize):
            print(f"motor server on ws://{HOST}:{PORT} (speed cap {MAX_SPEED})")
            await asyncio.Future()
    finally:
        watchdog.cancel()
        drivetrain.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
