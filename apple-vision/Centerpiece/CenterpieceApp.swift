import SwiftUI
import RealityKit
import Observation

@MainActor @Observable
final class ImmersiveExperience {
    static let spaceID = "RobotImmersiveSpace"
    static let launcherID = "CenterpieceLauncher"

    let relay = RelayClient()
    let hands = HandMotionController()
    let destina = DestinaClient()
    let audio = LiveAudioCapture()
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
    @State private var store = GameMasterStore()

    init() { Destina.registerFonts() }

    var body: some SwiftUI.Scene {
        WindowGroup(id: ImmersiveExperience.launcherID) {
            ImmersiveLauncher(session: session, experience: experience)
                .preferredColorScheme(.dark)
        }
        .defaultSize(width: 460, height: 300)
        .windowResizability(.contentSize)

        ImmersiveSpace(id: ImmersiveExperience.spaceID) {
            RobotImmersiveView(session: session, experience: experience, store: store)
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
        VStack(spacing: 16) {
            Text("destina")
                .font(Destina.wordmark(34))
                .foregroundStyle(Destina.text)
            Text("Game Master")
                .font(Destina.heading(22))
                .foregroundStyle(Destina.textMuted)
            Text(experience.launchMessage ?? message)
                .font(Destina.ui(13))
                .foregroundStyle(Destina.textMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if experience.isOpening {
                ProgressView("Opening immersive view…").tint(Destina.tan)
            } else if experience.isImmersed {
                Button("Return to immersive view") {
                    dismissWindow(id: ImmersiveExperience.launcherID)
                }
                .buttonStyle(SecondaryButtonStyle())
            } else {
                Button("Enter immersive view") { Task { await enter() } }
                    .buttonStyle(.destinaPrimary)
            }
        }
        .padding(32)
        .frame(width: 460, height: 300)
        .background(Destina.bg)
        .task {
            guard !experience.hasAttemptedLaunch else { return }
            await enter()
        }
    }

    private var message: String {
        experience.destina.isConfigured
            ? "Your room, the robot camera and the controls open in a full immersive space."
            : "No Destina server is configured. The immersive view opens in demo mode."
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

/// Full immersion hides passthrough. The Game Master workspace is laid out as
/// separate panels around the wearer rather than one flat rectangle: camera
/// ahead, roster and conversation angled in from the sides, and the stage
/// below, where choosing a prompt gives way to driving.
private struct RobotImmersiveView: View {
    let session: DemoSession
    @Bindable var experience: ImmersiveExperience
    @Bindable var store: GameMasterStore
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    @Environment(\.dismissImmersiveSpace) private var dismissImmersiveSpace
    @State private var isExiting = false
    // Seeded with a value no gate produces, so the first evaluation always logs.
    @State private var lastMotionBlock: String? = "not evaluated yet"

    private var client: DestinaClient { experience.destina }
    private var context: GameMasterContext {
        GameMasterContext(session: session, experience: experience, client: client, store: store)
    }

    /// Side panels are turned toward the wearer so they read without having to
    /// square up to them.
    private static let sideYaw: Float = 26 * .pi / 180

    var body: some View {
        RealityView { content, attachments in
            // Anchor once so the workspace stays still while the wearer looks
            // from panel to panel. A continuously head-locked UI would chase
            // the gaze.
            let origin = AnchorEntity(.head, trackingMode: .once)

            // Sized and placed so the stage below clears the camera's bottom
            // edge. The panels must not overlap: a prompt card drawn over the
            // feed hides the thing the Game Master is steering by.
            if let camera = attachments.entity(for: "camera") {
                camera.position = [0, 0.24, -2.0]
                camera.scale = [1.55, 1.55, 1.55]
                origin.addChild(camera)
            }
            if let roster = attachments.entity(for: "roster") {
                roster.position = [-1.15, 0.05, -1.55]
                roster.orientation = simd_quatf(angle: Self.sideYaw, axis: [0, 1, 0])
                roster.scale = [1.5, 1.5, 1.5]
                origin.addChild(roster)
            }
            if let conversation = attachments.entity(for: "conversation") {
                conversation.position = [1.15, 0.05, -1.55]
                conversation.orientation = simd_quatf(angle: -Self.sideYaw, axis: [0, 1, 0])
                conversation.scale = [1.5, 1.5, 1.5]
                origin.addChild(conversation)
            }
            if let stage = attachments.entity(for: "stage") {
                stage.position = [0, -0.47, -1.52]
                stage.orientation = simd_quatf(angle: -18 * .pi / 180, axis: [1, 0, 0])
                stage.scale = [1.15, 1.15, 1.15]
                origin.addChild(stage)
            }
            if let modal = attachments.entity(for: "modal") {
                modal.position = [0, 0, -1.15]
                modal.scale = [1.7, 1.7, 1.7]
                origin.addChild(modal)
            }
            content.add(origin)
        } attachments: {
            Attachment(id: "camera") {
                CameraScreen(experience: experience, client: client,
                             onSettings: { store.openPanel = .connection })
                    .preferredColorScheme(.dark)
            }
            Attachment(id: "roster") {
                RosterPanel(
                    feed: client.feed,
                    targetPlayerID: client.feed?.activeQuestion?.recommendation.targetPlayerID
                        ?? store.targetPlayerID,
                    rewards: client.feed?.rewards
                )
                .preferredColorScheme(.dark)
            }
            Attachment(id: "conversation") {
                ConversationPanel(client: client, store: store, audio: experience.audio, compact: true)
                    .preferredColorScheme(.dark)
            }
            Attachment(id: "stage") {
                StagePanel(context: context, onExitImmersive: exit)
                    .preferredColorScheme(.dark)
            }
            Attachment(id: "modal") {
                modalPanel.preferredColorScheme(.dark)
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
            experience.audio.stop()
            experience.hands.stop(model: session)
            experience.relay.disconnect(reason: "immersive view disappeared")
            client.stop()
            experience.isImmersed = false
            experience.isOpening = false
            session.controlsSuspended = false
            experience.launchMessage = "Immersive view closed. You can enter again when ready."
            openWindow(id: ImmersiveExperience.launcherID)
        }
    }

    /// Modal panels float closer than the workspace and suspend the controls
    /// underneath, which is what keeps the wheels still while one is open.
    @ViewBuilder
    private var modalPanel: some View {
        if let panel = store.openPanel {
            Group {
                switch panel {
                case .connection:
                    ConnectionPanel(experience: experience, session: session, client: client,
                                    onClose: { store.openPanel = nil })
                case .tokens:
                    TokensPanel(client: client, store: store, onClose: { store.openPanel = nil })
                case .session:
                    SessionPanel(client: client, store: store, onClose: { store.openPanel = nil })
                case .conversation:
                    VStack(alignment: .trailing, spacing: 14) {
                        ConversationPanel(client: client, store: store,
                                          audio: experience.audio, compact: false)
                        Button("Done") { store.openPanel = nil }
                            .buttonStyle(.destinaPrimary)
                    }
                case .promptPreview:
                    PromptPreviewPanel(
                        round: client.feed?.activeQuestion,
                        feed: client.feed,
                        promptURL: client.promptURL,
                        onClose: { store.openPanel = nil }
                    )
                }
            }
        }
    }

    /// Every gate between a held fist and a `drive` frame on the wire, in order.
    /// A quiet relay then names its own cause instead of looking like a dropped
    /// message. Zero wheels are a reason too: `sendDrive` turns them into a stop.
    private var motionBlockReason: String? {
        // Driving exists to deliver an assigned prompt. Without one there is
        // no target, so the wheels stay still even if everything else is ready.
        if store.stage(for: client.feed) != .driving && client.isConfigured {
            return "no prompt is assigned yet"
        }
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
