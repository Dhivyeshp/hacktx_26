import SwiftUI
import RealityKit
import Observation

@MainActor @Observable
final class ImmersiveExperience {
    static let spaceID = "RobotImmersiveSpace"
    static let launcherID = "CenterpieceLauncher"

    let relay = RelayClient()
    var useLiveVideo = RelayConfiguration.bundled() != nil
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
        .onAppear {
            experience.isImmersed = true
            experience.isOpening = false
            experience.launchMessage = nil
            dismissWindow(id: ImmersiveExperience.launcherID)
        }
        .onDisappear {
            session.emergencyStop()
            experience.relay.disconnect()
            experience.isImmersed = false
            experience.isOpening = false
            session.controlsSuspended = false
            experience.launchMessage = "Immersive view closed. You can enter again when ready."
            openWindow(id: ImmersiveExperience.launcherID)
        }
    }

    private func exit() {
        guard !isExiting else { return }
        isExiting = true
        session.emergencyStop()
        Task {
            // Create a recovery window before leaving the space.
            openWindow(id: ImmersiveExperience.launcherID)
            await dismissImmersiveSpace()
            isExiting = false
        }
    }
}
