"""Drive the badge face (firmware/badge-face) straight over USB serial, no relay.

    pip install pyserial
    python screen_test.py                      # interactive prompt
    python screen_test.py demo                 # cycle every face, then a QR code
    python screen_test.py face happy "hi Maya!"
    python screen_test.py qr https://example.com "Scan to join"
    python screen_test.py noqr

The port is auto-detected (/dev/ttyACM* on the Pi, /dev/cu.usbmodem* on a Mac);
override it with --port or ESP32_PORT. Every reply line from the badge is printed.
"""

import argparse
import glob
import json
import os
import sys
import threading
import time

import serial  # pyserial

FACES = ["neutral", "happy", "excited", "cute", "love", "wink",
         "surprised", "thinking", "sad", "angry", "sleepy"]

HELP = """commands:
  <face>                 change face: """ + " ".join(FACES) + """
  say <text>             set the caption ("say" alone clears it)
  qr <url> [caption]     show a QR code instead of the face
  noqr                   back to the face
  demo                   cycle through everything
  {...}                  send raw JSON
  quit"""


def find_port():
    ports = sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/cu.usbmodem*"))
    if not ports:
        sys.exit("no badge found; plug it in or pass --port")
    return ports[0]


def open_badge(port):
    s = serial.Serial()
    s.port = port
    s.baudrate = 115200
    s.timeout = 0.1
    # DTR and RTS drive the ESP32-C3's boot-mode and reset lines; keep them low.
    s.dtr = False
    s.rts = False
    s.open()
    return s


ready = threading.Event()


def print_replies(badge):
    while True:
        line = badge.readline()
        if line:
            text = line.decode(errors="replace").rstrip()
            if "screen_ready" in text:
                ready.set()
            print("  badge:", text)


def send(badge, **fields):
    msg = {"type": "screen", **fields}
    badge.write((json.dumps(msg) + "\n").encode())
    print("  sent: ", json.dumps(msg))


def demo(badge):
    for face in FACES:
        send(badge, face=face, text=face)
        time.sleep(2.5)
    send(badge, text="Scan to join!", qr="https://example.com/centerpiece")
    time.sleep(5)
    send(badge, qr=False, face="happy", text="")


def run_command(badge, line):
    word, _, rest = line.strip().partition(" ")
    if not word:
        return
    if word in FACES:
        send(badge, face=word)
    elif word == "say":
        send(badge, text=rest)
    elif word == "qr":
        url, _, caption = rest.partition(" ")
        send(badge, qr=url, text=caption) if url else print("usage: qr <url> [caption]")
    elif word == "noqr":
        send(badge, qr=False)
    elif word == "demo":
        demo(badge)
    elif line.lstrip().startswith("{"):
        badge.write((line.strip() + "\n").encode())
    else:
        print(HELP)


def main():
    parser = argparse.ArgumentParser(description="Test the badge face over USB serial.")
    parser.add_argument("--port", default=os.environ.get("ESP32_PORT") or None)
    parser.add_argument("command", nargs="*", help="demo | face <name> [text] | qr <url> [text] | noqr")
    args = parser.parse_args()

    port = args.port or find_port()
    badge = open_badge(port)
    print(f"connected to {port}")
    threading.Thread(target=print_replies, args=(badge,), daemon=True).start()
    # Opening the port resets the badge; give the firmware a moment to boot.
    ready.wait(timeout=3)

    cmd = args.command
    if cmd:
        if cmd[0] == "demo":
            demo(badge)
        elif cmd[0] == "face" and len(cmd) > 1:
            send(badge, face=cmd[1], **({"text": " ".join(cmd[2:])} if len(cmd) > 2 else {}))
        elif cmd[0] == "qr" and len(cmd) > 1:
            send(badge, qr=cmd[1], text=" ".join(cmd[2:]))
        elif cmd[0] == "noqr":
            send(badge, qr=False)
        else:
            parser.error("unknown command")
        time.sleep(0.5)  # let the ack print
        return

    print(HELP)
    while True:
        try:
            line = input("> ")
        except (EOFError, KeyboardInterrupt):
            break
        if line.strip() in ("quit", "exit"):
            break
        run_command(badge, line)


if __name__ == "__main__":
    main()
