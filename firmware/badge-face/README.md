# Badge face

Firmware that turns the Hack the North 2026 badge into the robot's face: black eyes and mouth on a white screen that blink, glance around, breathe, and hop when the expression changes. It can also swap the face for a QR code.

It runs standalone. Nothing needs to be connected beyond USB power.

- **Expressions:** the face switches to a new one by itself every 4 to 9 seconds. Friendly faces come up most often, with the occasional sad, angry or sleepy moment. The mix is `kAutoWeights` in `src/main.cpp`.
- **A button:** toggles the join QR code, `https://destina.ngrok.app/join/0AEDDD` (`kJoinUrl`). Press once to show it and again to go back to the face. It also returns to the face by itself after 10 seconds.
- **Start button:** steps through the faces by hand. The autopilot waits 8 seconds before taking over again.

The badge is an ESP32-C3-MINI-1 with a 320x240 ST7789 screen and native USB serial ([hardware docs](https://github.com/hackthenorth/badge-firmware/blob/main/docs/CUSTOM-FIRMWARE-HAL.md)). Flashing this replaces the stock badge firmware.

## Talking to it (optional)

The serial commands below still work, and the autopilot pauses for 8 seconds after each one. The robot no longer uses them.

Plug the badge into the Pi over USB-C. It shows up as `/dev/ttyACM0` on the Pi and `/dev/cu.usbmodem*` on a Mac. Send one JSON object per line. `relay/clients/pi/pi_client.py` already forwards `screen` messages from the relay when run with `ESP32_PORT=/dev/ttyACM0`.

```json
{"type":"screen","face":"happy","text":"Maya, you're up!"}
{"type":"screen","face":"sleepy","text":""}
{"type":"screen","qr":"https://example.com/join","text":"Scan to join"}
{"type":"screen","qr":false}
```

- **Fields:** `face`, `text` and `qr` are all optional. A field you leave out keeps its current value.
- **Faces:** `neutral`, `happy`, `excited`, `cute`, `love`, `wink`, `surprised`, `thinking`, `sad`, `angry`, `sleepy`.
- **QR code:** `qr: "<url>"` replaces the face with a QR code for that URL. `qr: true` re-shows the last URL and `qr: false` goes back to the face. Because the URL arrives in the message, the app link can change without reflashing.
- **Plain text:** a line that isn't JSON becomes the caption.
- **Acks:** the badge replies to each command with `{"screen_face":...,"screen_text":...,"screen_qr":...}`, which the Pi folds into its telemetry.

Opening the serial port resets the badge, and the firmware prints `{"screen_ready":true}` about half a second later. Wait for that line before sending anything. `relay/clients/pi/screen_test.py` does this for you and works from a laptop or the Pi:

```bash
pip install pyserial
python relay/clients/pi/screen_test.py demo                     # every face, then a QR code
python relay/clients/pi/screen_test.py face love "hi!"
python relay/clients/pi/screen_test.py qr https://example.com "Scan to join"
python relay/clients/pi/screen_test.py                          # interactive prompt
```

## NFC tags

The badge's MFRC522 reader can read and write NTAG213/215/216 stickers, which are the capsule tags. **Hold the tag on the flower pattern printed on the badge.** That's where the antenna coil is, and the range is only about a centimetre. A tag placed on the reader chip itself is out of range.

```json
{"type":"nfc_read"}
{"type":"nfc_write","url":"https://example.com/c?t=07"}
{"type":"nfc_write","text":"hello"}
```

Each command waits up to `timeout_ms` (default 3000) for a tag, then replies with one line. The face pauses while it waits.

```json
{"nfc":"nfc_write","uid":"042B3C6D5F6180","tag":"NTAG215","uri":"https://example.com/c?t=07","verified":true,"ok":true}
{"nfc":"nfc_read","ok":false,"error":"no tag found"}
```

- **What a write does:** it replaces the tag's NDEF message with a single URL or text record, then reads it back to verify. Phones open the URL on a background tap.
- **One tag at a time:** if several tags answer at once, nothing is read or written, and the reply is `"error":"more than one tag in range, hold just one"`. Once a tag is selected, only that tag responds, so a write never lands on two tags. Stacked tags also detune each other and sit beyond the short range, so program capsules one by one.
- **Targeting:** add `"uid":"042B3C6D5F6180"` to act only if that exact tag is in range. Otherwise the reply is `"wrong tag in range"`.
- **Supported tags:** MIFARE Classic cards and phones are detected but not written.
- **Testing:** `python relay/clients/pi/screen_test.py nfc read` and `... nfc write <url>`. `... nfc program "https://example.com/c?t=" 1 9` walks through tags 01 to 09 one at a time and skips any tag it has already written.

## Build and flash

PlatformIO needs Python 3.10 or newer, because pioarduino's esptool 5 won't run on macOS's built-in 3.9. That esptool build also breaks with click 8.2, so pin it.

```bash
pip install platformio "click<8.2"
cd firmware/badge-face
pio run -t upload            # add --upload-port /dev/cu.usbmodemXXXX if needed
```

The badge has no auto-reset into the bootloader. If the upload says "No serial data received", **hold Start while plugging in USB**, then upload again. The screen stays blank in download mode. After flashing, the badge can come back up still in download mode (blank screen). If so, unplug and replug it.
