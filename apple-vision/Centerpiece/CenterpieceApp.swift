import SwiftUI
import RealityKit
import Observation

@MainActor @Observable
final class ImmersiveExperience {
    static let spaceID = "RobotImmersiveSpace"
    static let launcherID = "CenterpieceLauncher"

    let relay = RelayClient()
    let hands = HandMotionController()
    var useLiveVideo = true
    var demoVideoAvailable = true
    var hasAttemptedLaunch = false
    var isOpening = false
    var isImmersed = false
    var launchMessage: String?
}

@main
struct CenterpieceApp: App {
    @State private var session = DemoSession()
    @State private var experience = ImmersiveExperience()

    var body: some SwiftUI.Scene {
        WindowGroup(id: ImmersiveExperience.launcherID) {
            ImmersiveLauncher(session: session, experience: experience)
                .preferredColorScheme(.dark)
        }
        .defaultSize(width: 460, height: 280)
        .windowResizability(.contentSize)

        ImmersiveSpace(id: ImmersiveExperience.spaceID) {
            RobotImmersiveView(session: session, experience: experience)
        }
        .immersionStyle(selection: .constant(.full), in: .full)
    }
}

/// A small entry/recovery window, automatically hidden after immersive startup.
private struct ImmersiveLauncher: View {
    let session: DemoSession
    @Bindable var experience: ImmersiveExperience
    @Environment(\.openImmersiveSpace) private var openImmersiveSpace
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "vision.pro.fill").font(.system(size: 36))
                .foregroundStyle(.mint)
            Text("Centerpiece").font(.title2.weight(.semibold))
            Text(experience.launchMessage ?? "Your robot camera and controls open in a full immersive space.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if experience.isOpening {
                ProgressView("Opening immersive view…")
            } else if experience.isImmersed {
                Button("Return to immersive view") { dismissWindow(id: ImmersiveExperience.launcherID) }
            } else {
                Button("Enter immersive view") { Task { await enter() } }
                    .buttonStyle(.borderedProminent).tint(.mint).foregroundStyle(.black)
            }
        }
        .padding(32).frame(width: 460, height: 280)
        .task {
            guard !experience.hasAttemptedLaunch else { return }
            await enter()
        }
    }

    private func enter() async {
        guard !experience.isOpening, !experience.isImmersed else { return }
        experience.hasAttemptedLaunch = true
        experience.isOpening = true
        experience.launchMessage = nil
        session.halt()
        switch await openImmersiveSpace(id: ImmersiveExperience.spaceID) {
        case .opened:
            experience.isOpening = false
            // The immersive view hides this window after it actually appears.
        case .userCancelled:
            experience.isOpening = false
            experience.launchMessage = "Opening was canceled. Select Enter immersive view to try again."
        case .error:
            experience.isOpening = false
            experience.launchMessage = "The immersive view could not open. Select Enter immersive view to retry."
        @unknown default:
            experience.isOpening = false
            experience.launchMessage = "Select Enter immersive view to try again."
        }
    }
}

/// Full immersion hides passthrough. The ordinary 2D camera is presented as a
/// large forward-facing screen, initialized at the wearer's head position.
private struct RobotImmersiveView: View {
    let session: DemoSession
    @Bindable var experience: ImmersiveExperience
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    @Environment(\.dismissImmersiveSpace) private var dismissImmersiveSpace
    @State private var isExiting = false
    // Seeded with a value no gate produces, so the first evaluation always logs.
    @State private var lastMotionBlock: String? = "not evaluated yet"

    var body: some View {
        RealityView { content, attachments in
            guard let dashboard = attachments.entity(for: "dashboard") else { return }
            // Anchor once so the screen stays still while the wearer looks at
            // the side panels. A continuously head-locked UI would chase the gaze.
            let origin = AnchorEntity(.head, trackingMode: .once)
            dashboard.position = [0, 0, -1.6]
            dashboard.scale = [2.5, 2.5, 2.5]
            origin.addChild(dashboard)
            content.add(origin)
        } attachments: {
            Attachment(id: "dashboard") {
                DashboardView(session: session, experience: experience, onExitImmersive: exit)
                    .preferredColorScheme(.dark)
            }
        }
        .task(id: session.handDrivingEnabled) {
            if session.handDrivingEnabled { await experience.hands.run(model: session) }
            else { experience.hands.stop(model: session) }
        }
        .task {
            while !Task.isCancelled {
                syncMotion()
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
            }
        }
        .onChange(of: session.wheelCommand) { _, _ in syncMotion() }
        .onChange(of: session.handDrivingEnabled) { _, enabled in
            print("[hands] Driving enabled: \(enabled)")
            syncMotion()
        }
        .onChange(of: session.controlsSuspended) { _, _ in syncMotion() }
        .onChange(of: experience.relay.canControlRobot) { _, canControl in
            print("[relay] Can control: \(canControl), connected: \(experience.relay.isConnected), fresh video: \(experience.relay.hasFreshFrame)")
            if experience.useLiveVideo && !canControl && session.handDrivingEnabled {
                session.emergencyStop(reason: "Relay disconnected, video stale, or Pi absent")
            }
            syncMotion()
        }
        .onAppear {
            experience.isImmersed = true
            experience.isOpening = false
            experience.launchMessage = nil
            dismissWindow(id: ImmersiveExperience.launcherID)
        }
        .onDisappear {
            session.emergencyStop(reason: "Immersive view closed")
            experience.hands.stop(model: session)
            experience.relay.disconnect(reason: "immersive view disappeared")
            experience.isImmersed = false
            experience.isOpening = false
            session.controlsSuspended = false
            experience.launchMessage = "Immersive view closed. You can enter again when ready."
            openWindow(id: ImmersiveExperience.launcherID)
        }
    }

    /// Every gate between a held pinch and a `drive` frame on the wire, in order.
    /// A quiet relay then names its own cause instead of looking like a dropped
    /// message. Zero wheels are a reason too: `sendDrive` turns them into a stop.
    private var motionBlockReason: String? {
        if !experience.useLiveVideo { return "live relay video is off" }
        if !session.handDrivingEnabled { return "hand driving is not enabled" }
        if let reason = session.driveBlockReason { return reason }
        if session.armed { return "the drop is armed" }
        if let reason = experience.relay.controlBlockReason { return reason }
        if session.wheelCommand == .zero { return "hands are neutral" }
        return nil
    }

    private func syncMotion() {
        let reason = motionBlockReason
        if reason != lastMotionBlock {
            if let reason { print("[relay] Wheels idle: \(reason)") }
            else { print("[relay] Wheels driving") }
            lastMotionBlock = reason
        }
        guard reason == nil else {
            experience.relay.stopRobot()
            experience.relay.noteMotionIdle(reason)
            return
        }
        let wheels = session.wheelCommand
        experience.relay.sendDrive(left: wheels.left, right: wheels.right)
    }

    private func exit() {
        guard !isExiting else { return }
        isExiting = true
        session.emergencyStop(reason: "Exit immersive selected")
        Task {
            // Create a recovery window before leaving the space.
            openWindow(id: ImmersiveExperience.launcherID)
            await dismissImmersiveSpace()
            isExiting = false
        }
    }
}
