"""Drive the badge face (firmware/badge-face) straight over USB serial, no relay.

    pip install pyserial
    python screen_test.py                      # interactive prompt
    python screen_test.py demo                 # cycle every face, then a QR code
    python screen_test.py face happy "hi Maya!"
    python screen_test.py qr https://example.com "Scan to join"
    python screen_test.py noqr
    python screen_test.py nfc read             # hold a tag on the badge's flower pattern
    python screen_test.py nfc write https://example.com/c?t=07
    python screen_test.py nfc program "https://example.com/c?t=" 1 9   # one tag at a time

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
  nfc read               read the tag held to the badge
  nfc write <url|text>   write an NDEF URL (or text) to it
  nfc program <base> <first> <last>
                         write <base>01, <base>02, ... to a series of tags
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
nfc_done = threading.Event()
nfc_reply = {}


def print_replies(badge):
    while True:
        line = badge.readline()
        if line:
            text = line.decode(errors="replace").rstrip()
            if "screen_ready" in text:
                ready.set()
            if text.startswith('{"nfc"'):
                nfc_reply.clear()
                nfc_reply.update(json.loads(text))
                nfc_done.set()
            print("  badge:", text)


def send(badge, **fields):
    msg = {"type": "screen", **fields}
    badge.write((json.dumps(msg) + "\n").encode())
    print("  sent: ", json.dumps(msg))


def nfc_request(badge, msg):
    nfc_done.clear()
    badge.write((json.dumps(msg) + "\n").encode())
    print("  sent: ", json.dumps(msg), "(hold the tag on the flower pattern)")
    nfc_done.wait(timeout=(msg.get("timeout_ms", 3000) / 1000) + 3)
    return dict(nfc_reply) if nfc_done.is_set() else {"ok": False, "error": "badge didn't answer"}


def nfc_program(badge, base, first, last):
    """Write base+NN to tags one at a time, refusing a tag that's already done."""
    done = {}
    n = first
    while n <= last:
        url = f"{base}{n:02d}"
        if input(f"\nPut tag {n} (alone) on the flower, then Enter (q to stop): ").strip() == "q":
            break
        found = nfc_request(badge, {"type": "nfc_read"})
        uid = found.get("uid")
        if not found.get("ok"):
            print("  !", found.get("error"))
            continue
        if uid in done:
            print(f"  ! that's the tag already written with {done[uid]}; swap it for a new one")
            continue
        wrote = nfc_request(badge, {"type": "nfc_write", "uid": uid, "url": url})
        if wrote.get("ok") and wrote.get("verified"):
            done[uid] = url
            print(f"  wrote {url} to {uid}")
            n += 1
        else:
            print("  ! write failed:", wrote.get("error"), "- try again")
    print("\nprogrammed:")
    for uid, url in done.items():
        print(f"  {uid}  {url}")


def nfc(badge, args):
    if args[:1] == ["program"] and len(args) == 4:
        nfc_program(badge, args[1], int(args[2]), int(args[3]))
        return
    if args[:1] == ["read"]:
        msg = {"type": "nfc_read"}
    elif args[:1] == ["write"] and len(args) > 1:
        value = " ".join(args[1:])
        msg = {"type": "nfc_write", "url" if "://" in value else "text": value}
    else:
        print("usage: nfc read | nfc write <url|text> | nfc program <base> <first> <last>")
        return
    nfc_request(badge, msg)


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
    elif word == "nfc":
        nfc(badge, rest.split())
    elif word == "demo":
        demo(badge)
    elif line.lstrip().startswith("{"):
        badge.write((line.strip() + "\n").encode())
    else:
        print(HELP)


def main():
    parser = argparse.ArgumentParser(description="Test the badge face over USB serial.")
    parser.add_argument("--port", default=os.environ.get("ESP32_PORT") or None)
    parser.add_argument("command", nargs="*", help="demo | face <name> [text] | qr <url> [text] | noqr | nfc read | nfc write <url>")
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
        elif cmd[0] == "nfc":
            nfc(badge, cmd[1:])
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
