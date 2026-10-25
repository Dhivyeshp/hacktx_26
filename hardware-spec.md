erseids Robot Car: Vision Pro WebSocket Control
Hardware
- Raspberry Pi 4, L293D motor driver, two DC geared motors (differential drive).
- Pi powered separately via USB-C; 4×AA pack supplies motor power (only if motor voltage/current ratings are compatible).
- Common ground: AA negative, Pi GND, and L293D pins 4, 5, 12, 13.
- Never connect AA positive to Pi 5V or GPIO.
GPIO wiring (BCM numbering)
Signal	Pi GPIO	Pi physical pin	L293D pin
Left forward	17	11	2 (IN1)
Left reverse	27	13	7 (IN2)
Left enable/PWM	18	12	1 (EN1)
Right forward	22	15	10 (IN3)
Right reverse	23	16	15 (IN4)
Right enable/PWM	13	33	9 (EN2)
Logic 5V	—	2	16 (VCC1)
GND	—	6	4, 5, 12, 13
AA positive	—	Do not connect to Pi	8 (VCC2)


Left motor: L293D outputs 3 and 6. Right motor: outputs 11 and 14. AA negative connects to the common ground rail.
Architecture
visionOS SwiftUI app → Wi-Fi WebSocket → Python server on Pi → gpiozero.Motor → L293D → wheels.
- Server: Python 3, asyncio, websockets, gpiozero.
- Listen on port 8765, on a trusted LAN only.
- Connect from Vision Pro using ws://<PI_IP>:8765 (find IP with hostname -I).
- visionOS client: URLSessionWebSocketTask; send commands ~20 times/sec while controlling.
JSON protocol
{"type":"drive","left":0.5,"right":0.5}
{"type":"drive","left":-0.4,"right":0.4}
{"type":"stop"}
{"type":"heartbeat"}
Wheel speeds range from -1.0 to +1.0 (reverse to forward). For joystick axes x (steering) and y (forward), compute left = clamp(y+x,-1,1) and right = clamp(y-x,-1,1). If steering is reversed, swap signs.
Required safety behavior
- Motors stopped at startup, disconnect, app inactivity, and server shutdown.
- Stop motors if no valid command/heartbeat received for 300 ms (monotonic watchdog).
- Reject malformed commands; clamp speed; initially cap PWM to 50%.
- Authenticate clients and allow only one active controller; do not expose port publicly.
- Include a prominent STOP control and a physical motor-power cutoff.
- Test with wheels lifted off the ground before driving.
Build goal
Create a Python WebSocket motor-control server for Raspberry Pi and a visionOS SwiftUI joystick controller that implements the wiring, JSON messages, and safety behavior above.