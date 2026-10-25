import SwiftUI

/// The Game Master surface, in place of the old single flat dashboard.
///
/// It is split into separately anchored panels so the wearer looks around a
/// workspace rather than at one rectangle: the camera straight ahead, the
/// roster and the conversation angled in from the sides, and a stage below
/// that changes with what the Game Master is doing.
/// Shared references, so each panel takes one parameter instead of four.
@MainActor
struct GameMasterContext {
    let session: DemoSession
    let experience: ImmersiveExperience
    let client: DestinaClient
    let store: GameMasterStore
}

// MARK: - Camera

/// The Pi feed. Unchanged behaviour: live JPEGs, a dimmed last frame when they
/// go stale, and an explicit switch to the demo photo rather than a silent one.
struct CameraScreen: View {
    @Bindable var experience: ImmersiveExperience
    @Bindable var client: DestinaClient
    var onSettings: () -> Void

    private var relay: RelayClient { experience.relay }
    private var useLiveVideo: Bool { experience.useLiveVideo }

    var body: some View {
        VStack(spacing: 0) {
            header
            ZStack {
                Color.black
                if useLiveVideo {
                    if let frame = relay.latestFrame {
                        Image(decorative: frame, scale: 1)
                            .resizable().scaledToFit()
                            .opacity(relay.hasFreshFrame ? 1 : 0.35)
                    }
                    if !relay.hasFreshFrame {
                        VStack(spacing: 10) {
                            Image(systemName: "video.slash").font(.title)
                            Text(relay.status).font(Destina.ui(15, weight: .medium))
                            Text(relay.isConfigured
                                 ? "The Pi must stream to the same relay room."
                                 : "Open camera settings for setup.")
                                .font(Destina.ui(12))
                                .foregroundStyle(Destina.textMuted)
                        }
                    }
                } else {
                    Image("DemoTable").resizable().scaledToFill()
                        .opacity(experience.demoVideoAvailable ? 1 : 0.35)
                    if !experience.demoVideoAvailable {
                        Label("Demo video unavailable", systemImage: "video.slash")
                            .font(Destina.ui(15, weight: .medium))
                    }
                }
            }
            .frame(width: 1040, height: 620)
            .clipped()
            .allowsHitTesting(false)
            .accessibilityLabel(useLiveVideo
                                ? "Robot camera: \(relay.status)"
                                : "Illustrative demo camera photo")
        }
        .background(Destina.bg)
        .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
    }

    private var header: some View {
        HStack(spacing: 14) {
            Text("destina")
                .font(Destina.wordmark(26))
                .foregroundStyle(Destina.text)
            Rectangle().fill(Destina.line).frame(width: 1, height: 20)
            Text(client.feed?.room.name ?? "Game Master")
                .font(Destina.heading(20))
                .foregroundStyle(Destina.textMuted)
            Spacer()
            if client.isRefreshing {
                ProgressView().controlSize(.mini).tint(Destina.tan)
            }
            Button(action: onSettings) {
                HStack(spacing: 10) {
                    Image(systemName: useLiveVideo ? "video.fill" : "photo")
                        .foregroundStyle(Destina.text)
                    VStack(alignment: .leading, spacing: 2) {
                        Eyebrow("Robot cam 01")
                        Text(useLiveVideo ? relay.status : "Demo photo")
                            .font(Destina.ui(10))
                            .foregroundStyle(Destina.textMuted)
                    }
                    StatusDot(ok: useLiveVideo && relay.hasFreshFrame)
                }
                .padding(.horizontal, 14)
                .frame(height: 44)
                .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel("Camera settings")
        }
        .padding(.horizontal, 20)
        .frame(width: 1040, height: 62)
    }
}

// MARK: - Stage

/// The panel that changes with the stage: choose a prompt, drive to deliver
/// it, then record the outcome. It also owns the app lifecycle wiring, because
/// it is the one panel that is always present.
struct StagePanel: View {
    let context: GameMasterContext
    var onExitImmersive: () -> Void

    @Environment(\.scenePhase) private var scenePhase

    private var session: DemoSession { context.session }
    private var experience: ImmersiveExperience { context.experience }
    private var client: DestinaClient { context.client }
    private var store: GameMasterStore { context.store }
    private var relay: RelayClient { experience.relay }
    private var feed: GameMasterFeed? { client.feed }
    private var videoAvailable: Bool {
        experience.useLiveVideo ? relay.hasFreshFrame : experience.demoVideoAvailable
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            toolbar
            content
        }
        // A fixed height, filled from the top. The stage is much shorter while
        // driving than while choosing, and letting it resize would move it up
        // into the camera and shift the toolbar under the wearer's gaze.
        .frame(maxWidth: 1200, alignment: .leading)
        .frame(height: 756, alignment: .top)
        .onAppear { start() }
        .onDisappear { finish() }
        .onChange(of: experience.useLiveVideo) { _, live in
            session.disableHandDriving(reason: "Camera mode changed")
            if live { relay.connect() } else { relay.disconnect(reason: "demo camera selected") }
            updateVideoAvailability()
        }
        .onChange(of: videoAvailable) { _, _ in updateVideoAvailability() }
        .onChange(of: scenePhase) { _, phase in
            print("[relay] Scene phase: \(phase)")
            session.setSceneActive(phase == .active)
            switch phase {
            case .active:
                if experience.useLiveVideo { relay.connect() }
                client.start()
            case .inactive:
                // Pause commands without canceling tracking. Returning to
                // active requires neutral hands, never a held gesture.
                experience.hands.requireNeutralReset(model: session)
                relay.stopRobot()
            case .background:
                session.emergencyStop(reason: "App moved to background")
                relay.disconnect(reason: "scene backgrounded")
                client.stop()
            @unknown default:
                session.emergencyStop(reason: "Unknown scene state")
                relay.stopRobot()
            }
        }
        .onChange(of: store.openPanel) { _, panel in
            session.controlsSuspended = panel != nil
            if panel != nil { session.halt() }
        }
        .onChange(of: feed?.activeQuestion?.id) { _, _ in
            store.roundChanged(to: feed?.activeQuestion)
            syncAssignedPrompt()
        }
        .task {
            while !Task.isCancelled {
                session.tick()
                do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
            }
        }
    }

    private var toolbar: some View {
        HStack(spacing: 12) {
            stageLabel
            Spacer()
            if let notice = client.lastError {
                Text(notice)
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.tanHover)
                    .lineLimit(2)
                    .frame(maxWidth: 280, alignment: .trailing)
            }
            Button("Conversation") { store.openPanel = .conversation }
                .buttonStyle(SecondaryButtonStyle())
            Button("Tina Tokens") { store.openPanel = .tokens }
                .buttonStyle(SecondaryButtonStyle())
            Button("Session") { store.openPanel = .session }
                .buttonStyle(SecondaryButtonStyle())
            Button("Exit immersive", action: onExitImmersive)
                .buttonStyle(SecondaryButtonStyle())
        }
    }

    private var stageLabel: some View {
        HStack(spacing: 10) {
            StatusDot(ok: client.blockReason == nil)
            Text(client.blockReason ?? label)
                .font(Destina.ui(12))
                .foregroundStyle(client.blockReason == nil ? Destina.textMuted : Destina.tanHover)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 360, alignment: .leading)
    }

    private var label: String {
        switch store.stage(for: feed) {
        case .waiting: return "Waiting for people to join and save their interests."
        case .choosing: return "Choose the next prompt."
        case .driving: return "Drive Tina to the person this prompt is for."
        case .reviewing: return "Record how the turn went."
        }
    }

    @ViewBuilder
    private var content: some View {
        if let recommendation = store.editingRecommendation {
            PromptEditSheet(
                recommendation: recommendation,
                participantNames: feed?.names(for: recommendation) ?? "the table",
                instructions: Binding(
                    get: { store.editedInstructions },
                    set: { store.editedInstructions = $0 }
                ),
                isAssigning: client.isBusy("assign"),
                onCancel: { store.editingRecommendation = nil },
                onAssign: { text in
                    Task {
                        if await client.assign(recommendationID: recommendation.id, instructions: text) {
                            store.editingRecommendation = nil
                            announceAssignment()
                        }
                    }
                }
            )
        } else {
            switch store.stage(for: feed) {
            case .waiting, .choosing:
                PromptWorkbenchView(
                    client: client,
                    store: store,
                    onAssigned: { _ in announceAssignment() }
                )
            case .driving:
                if let round = feed?.activeQuestion {
                    VStack(alignment: .leading, spacing: 14) {
                        CurrentPromptView(
                            round: round, feed: feed, client: client, compact: true,
                            onPreview: { store.openPanel = .promptPreview }
                        )
                        .destinaPanel(14)
                        DriveControlsView(
                            session: session,
                            experience: experience,
                            round: round,
                            targetName: feed?.name(for: round.recommendation.targetPlayerID) ?? "the table",
                            onDelivered: { store.noteDelivered(round) },
                            onPreview: { store.openPanel = .promptPreview }
                        )
                    }
                }
            case .reviewing:
                if let round = feed?.activeQuestion {
                    CurrentPromptView(
                        round: round, feed: feed, client: client, compact: false,
                        onPreview: { store.openPanel = .promptPreview }
                    )
                    .frame(width: 620, alignment: .leading)
                    .destinaPanel(22)
                }
            }
        }
    }

    // MARK: - Lifecycle

    private func start() {
        session.setSceneActive(scenePhase == .active)
        if experience.useLiveVideo { relay.connect() }
        updateVideoAvailability()
        client.start()
        // A prompt already on the table when the headset joins means the round
        // is mid-flight. The first poll picks that up through syncAssignedPrompt.
        syncAssignedPrompt()
    }

    /// Keep the driving model in step with the server. Clearing the prompt
    /// stops the wheels, because there is no longer anyone to deliver to.
    private func syncAssignedPrompt() {
        guard let round = feed?.activeQuestion else {
            session.setAssignedPrompt(nil)
            return
        }
        session.setAssignedPrompt(
            QuestionSelection(
                playerID: 0,
                playerName: feed?.name(for: round.recommendation.targetPlayerID) ?? "the table",
                questionIndex: round.number,
                question: round.recommendation.title
            )
        )
    }

    private func finish() {
        session.emergencyStop(reason: "Game Master view closed")
        relay.disconnect(reason: "dashboard disappeared")
        client.stop()
        session.controlsSuspended = false
    }

    private func updateVideoAvailability() {
        guard session.cameraAvailable != videoAvailable else { return }
        session.cameraAvailable = videoAvailable
        session.cameraChanged()
    }

    /// Tina's badge should say what the table was just handed. The relay
    /// already defines this message; it costs nothing and makes the robot
    /// arrive carrying the right thing.
    private func announceAssignment() {
        guard let round = feed?.activeQuestion else { return }
        syncAssignedPrompt()
        relay.sendScreen(face: "excited", text: round.recommendation.title)
    }
}

// MARK: - Camera settings

/// The existing diagnostics panel, with the Destina server's own state added
/// so a quiet feed can be told apart from a quiet relay.
struct ConnectionPanel: View {
    @Bindable var experience: ImmersiveExperience
    @Bindable var session: DemoSession
    @Bindable var client: DestinaClient
    var onClose: () -> Void

    private var relay: RelayClient { experience.relay }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Eyebrow("Camera and connection")
            Text("What is connected")
                .font(Destina.heading(30))
                .foregroundStyle(Destina.text)
            Toggle("Live relay video", isOn: $experience.useLiveVideo)
                .font(Destina.ui(14))
                .tint(Destina.tan)
            Text(experience.useLiveVideo ? relay.status : "Showing an illustrative photo, not live video.")
                .font(Destina.ui(12))
                .foregroundStyle(Destina.textMuted)
            if !relay.isConfigured {
                Text("Add RELAY_TOKEN to apple-vision/.env, then rebuild and run from Xcode.")
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if experience.useLiveVideo {
                Text("Room: \(relay.room) · JPEG frames: \(relay.framesReceived)")
                    .font(Destina.ui(11).monospacedDigit())
                    .foregroundStyle(Destina.textMuted)
                Text("Peers: \(relay.peers.isEmpty ? "none" : relay.peers.joined(separator: ", "))")
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.textMuted)
                Text("Wheel control: \(relay.controlBlockReason ?? "ready")")
                    .font(Destina.ui(11))
                    .foregroundStyle(relay.controlBlockReason == nil ? Destina.sage : Destina.tan)
                Button("Reconnect") { relay.reconnect() }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(!relay.isConfigured)
            } else {
                Toggle("Demo video available", isOn: $experience.demoVideoAvailable)
                    .font(Destina.ui(14))
                    .tint(Destina.tan)
            }
            Rectangle().fill(Destina.line).frame(height: 1)
            Eyebrow("Destina")
            Text(client.isConfigured
                 ? "Room \(client.room) · transcript from \(client.transcriptSource)"
                 : "No server configured. Add DESTINA_URL, DESTINA_ROOM and GM_API_KEY to apple-vision/.env.")
                .font(Destina.ui(11))
                .foregroundStyle(Destina.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            if let error = client.lastError {
                Text(error)
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.tanHover)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button("Refresh now") { Task { await client.refresh() } }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(!client.isConfigured)
            Rectangle().fill(Destina.line).frame(height: 1)
            Picker("Next demo drop failure", selection: $session.failure) {
                ForEach(DemoFailure.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .font(Destina.ui(12))
            .disabled(session.isBusy)
            ScrollView {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(session.events.enumerated()), id: \.offset) { _, event in
                        Text(event).font(Destina.ui(11)).foregroundStyle(Destina.textMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 110)
            Button("Done", action: onClose)
                .buttonStyle(.destinaPrimary)
        }
        .frame(width: 560, alignment: .leading)
        .destinaPanel(28)
    }
}
