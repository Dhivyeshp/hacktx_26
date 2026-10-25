# Badge face

Firmware that turns the Hack the North 2026 badge into the robot's face: black eyes and mouth on a white screen that blink, glance around, breathe, and hop when the expression changes. It can also swap the face for a QR code.

The badge is an ESP32-C3-MINI-1 with a 320x240 ST7789 screen and native USB serial ([hardware docs](https://github.com/hackthenorth/badge-firmware/blob/main/docs/CUSTOM-FIRMWARE-HAL.md)). Flashing this replaces the stock badge firmware.

## Talking to it

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
- **Start button:** cycles through the faces.

Opening the serial port resets the badge, and the firmware prints `{"screen_ready":true}` about half a second later. Wait for that line before sending anything. `relay/clients/pi/screen_test.py` does this for you and works from a laptop or the Pi:

```bash
pip install pyserial
python relay/clients/pi/screen_test.py demo                     # every face, then a QR code
python relay/clients/pi/screen_test.py face love "hi!"
python relay/clients/pi/screen_test.py qr https://example.com "Scan to join"
python relay/clients/pi/screen_test.py                          # interactive prompt
```

## Build and flash

PlatformIO needs Python 3.10 or newer, because pioarduino's esptool 5 won't run on macOS's built-in 3.9. That esptool build also breaks with click 8.2, so pin it.

```bash
pip install platformio "click<8.2"
cd firmware/badge-face
pio run -t upload            # add --upload-port /dev/cu.usbmodemXXXX if needed
```

The badge has no auto-reset into the bootloader. If the upload says "No serial data received", **hold Start while plugging in USB**, then upload again. The screen stays blank in download mode. After flashing, the badge can come back up still in download mode (blank screen). If so, unplug and replug it.
