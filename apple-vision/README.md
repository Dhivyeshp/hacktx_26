# Centerpiece · Vision Pro

A native, offline SwiftUI mockup of the Game Master control panel. No backend, network access, credentials, or robot required.

## Run

1. Open `Centerpiece.xcodeproj` in Xcode with the visionOS platform installed.
2. Select the **Centerpiece** scheme and an Apple Vision Pro simulator, then Run.
3. For a real headset, select your signing team under Signing & Capabilities and choose the paired headset as the destination.

If Xcode says the visionOS platform is not installed, install it from **Xcode → Settings → Components** first. The SDK headers alone are not sufficient to launch the simulator.

The app opens as a floating window. On a headset, look at controls and pinch to select. In the simulator, use its pointer interaction controls.

## Demo walkthrough

- Choose one of three sample challenge cards. Hot Seat is selected initially.
- Select **Deliver to …**, then confirm. Cancel leaves the selection unchanged.
- Watch the simulated sequence: sending → delivering → delivered, with an animated carousel illustration.
- Select **Stop demo** during delivery to cancel. **Try another round** resets the sequence.
- Open **Demo controls** to simulate a robot error on the next delivery or reset the demo.
- Pause/resume the camera illustration using the camera panel button. It is labeled simulated throughout; no real video is displayed.

All player names, recommendations, talk-time numbers, and robot events are sample data. Reset replays the same sample round; it does not advance a real game. The Stop control only cancels the local simulation.

## Files

- `CenterpieceApp.swift`: app entry point and floating window configuration.
- `DashboardView.swift`: recommendation cards, simulated camera, talk-time summary, confirmation and status controls.
- `DemoSession.swift`: sample recommendations and cancellable delivery state machine.

## Later integration

Replace `DemoSession`'s timed transitions with server acknowledgments and robot status messages. Keep the view driven by session state. Replace `RobotPreview` with decoded frames from the separate camera connection. Agree on the server message contract before adding transport; this mockup invents no backend endpoints or wire format.

Table/AprilTag anchoring, voice editing, target swapping, real camera streaming, and Golden capsule hand tracking are not implemented. This version is the floating-window UI prototype.
