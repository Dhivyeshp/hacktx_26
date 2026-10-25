"""Raspberry Pi side of the relay.

Streams the USB webcam as JPEG binary frames, sends robot telemetry as JSON,
and forwards commands from the Vision Pro / hub to the ESP32 over serial
(one JSON object per line).

    pip install -r requirements.txt
    RELAY_URL=wss://<host>/ws RELAY_TOKEN=... python pi_client.py
"""

import asyncio
import json
import os
import time

import cv2
from websockets.asyncio.client import connect

from motor_server import WATCHDOG_S, Drivetrain, parse_command

RELAY_URL = os.environ.get("RELAY_URL", "ws://localhost:8080/ws")
RELAY_TOKEN = os.environ.get("RELAY_TOKEN", "")
ROOM = os.environ.get("RELAY_ROOM", "table")
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "0"))
FPS = float(os.environ.get("CAMERA_FPS", "12"))
JPEG_QUALITY = int(os.environ.get("JPEG_QUALITY", "60"))
FRAME_WIDTH = int(os.environ.get("FRAME_WIDTH", "640"))
SERIAL_PORT = os.environ.get("ESP32_PORT", "")  # e.g. /dev/ttyUSB0; empty = no ESP32
ROBOT_ID = os.environ.get("ROBOT_ID", "bot-1")
DRIVE_MOTORS = os.environ.get("DRIVE_MOTORS", "1") == "1"  # drive/stop go to GPIO, not the ESP32

# Commands the Pi forwards to the ESP32 untouched.
ESP32_COMMANDS = {"drive", "stop", "deliver", "dispense", "screen"}


def open_serial():
    if not SERIAL_PORT:
        return None
    import serial  # pyserial

    s = serial.Serial()
    s.port = SERIAL_PORT
    s.baudrate = 115200
    s.timeout = 0
    # DTR and RTS drive the ESP32-C3's boot-mode and reset lines; keep them low.
    s.dtr = False
    s.rts = False
    s.open()
    return s


def url_with_params():
    sep = "&" if "?" in RELAY_URL else "?"
    url = f"{RELAY_URL}{sep}role=pi&room={ROOM}&id={ROBOT_ID}"
    return url + (f"&token={RELAY_TOKEN}" if RELAY_TOKEN else "")


async def send_frames(ws, cam):
    period = 1.0 / FPS
    while True:
        started = time.monotonic()
        ok, frame = await asyncio.to_thread(cam.read)
        if ok:
            h, w = frame.shape[:2]
            if w > FRAME_WIDTH:
                frame = cv2.resize(frame, (FRAME_WIDTH, int(h * FRAME_WIDTH / w)))
            ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            if ok:
                await ws.send(jpeg.tobytes())
        await asyncio.sleep(max(0.0, period - (time.monotonic() - started)))


async def send_telemetry(ws, esp32, state):
    while True:
        # The ESP32 can report its own status lines ({"type":"status",...}); merge them in.
        if esp32 is not None:
            for line in esp32.readlines():
                try:
                    status = json.loads(line)
                except ValueError:
                    continue
                if isinstance(status, dict):
                    status.pop("type", None)  # don't let it rename the telemetry message
                    state.update(status)
        await ws.send(json.dumps({"type": "telemetry", "robot_id": ROBOT_ID, **state}))
        await asyncio.sleep(0.1)


async def receive_commands(ws, esp32, state, motors, last_cmd):
    async for message in ws:
        if isinstance(message, bytes):
            continue
        try:
            msg = json.loads(message)
        except ValueError:
            continue
        kind = msg.get("type")
        if kind in ("drive", "stop") and motors is not None:
            cmd = parse_command(message)
            if cmd is None:
                continue
            last_cmd[0] = time.monotonic()
            if cmd["type"] == "drive":
                motors.drive(cmd["left"], cmd["right"])
                state["state"] = "navigating"
            else:
                motors.stop()
                state["state"] = "idle"
            print("->motors", cmd)
        elif kind in ESP32_COMMANDS:
            if esp32 is not None:
                esp32.write((json.dumps(msg) + "\n").encode())
            print("->esp32", msg)
        elif kind in ("welcome", "presence", "error"):
            print(kind, msg)


async def motor_watchdog(motors, state, last_cmd):
    # Same 300 ms dead-man stop as motor_server.py; also covers a dropped relay link.
    while True:
        if time.monotonic() - last_cmd[0] > WATCHDOG_S:
            motors.stop()
            if state.get("state") == "navigating":
                state["state"] = "idle"
        await asyncio.sleep(0.05)


async def main():
    cam = cv2.VideoCapture(CAMERA_INDEX)
    esp32 = open_serial()
    state = {"state": "idle", "battery_v": None, "capsules_left": None}
    motors = Drivetrain() if DRIVE_MOTORS else None  # L293D wired to the Pi GPIO
    last_cmd = [time.monotonic()]
    watchdog = asyncio.create_task(motor_watchdog(motors, state, last_cmd)) if motors else None
    backoff = 1
    try:
        while True:
            try:
                async with connect(url_with_params(), max_size=None, ping_interval=20) as ws:
                    print("connected to relay")
                    backoff = 1
                    await asyncio.gather(
                        send_frames(ws, cam),
                        send_telemetry(ws, esp32, state),
                        receive_commands(ws, esp32, state, motors, last_cmd),
                    )
            except Exception as exc:  # reconnect on any drop
                if motors:
                    motors.stop()
                print(f"relay connection lost ({exc!r}); retrying in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 15)
    finally:
        if watchdog:
            watchdog.cancel()
        if motors:
            motors.close()


if __name__ == "__main__":
    asyncio.run(main())
