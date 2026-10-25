import SwiftUI

private let mint = Color(red: 0.65, green: 0.94, blue: 0.79)

struct DashboardView: View {
    @Bindable var session: DemoSession
    @Bindable var experience: ImmersiveExperience
    var onExitImmersive: () -> Void = {}
    private var relay: RelayClient { experience.relay }
    private var useLiveVideo: Bool { experience.useLiveVideo }
    private var demoVideoAvailable: Bool { experience.demoVideoAvailable }
    @State private var panel: Panel?
    @Environment(\.scenePhase) private var scenePhase

    private enum Panel: String, Identifiable {
        case connection, sharedPage
        var id: String { rawValue }
    }
    private var videoAvailable: Bool { useLiveVideo ? relay.hasFreshFrame : demoVideoAvailable }

    var body: some View {
        ZStack(alignment: .topLeading) {
            cameraBackground
            VStack(spacing: 22) {
                header
                HStack(alignment: .top, spacing: 16) {
                    playerRail
                    if session.isDriving { drivingPanel } else { questionPanel }
                    Spacer(minLength: 28)
                    transcriptPanel
                }
                Spacer(minLength: 0)
            }
            .padding(24)
            if let panel {
                Color.black.opacity(0.5)
                    .onTapGesture { self.panel = nil }
                Group {
                    switch panel {
                    case .connection: connectionPanel
                    case .sharedPage: sharedPage
                    }
                }
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 26))
                .overlay(RoundedRectangle(cornerRadius: 26).stroke(.white.opacity(0.15)))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 1280, height: 800)
        .clipped()
        .onAppear {
            session.setSceneActive(scenePhase == .active)
            if session.selectedPlayer == nil { session.selectPlayer(Player.samples[0]) }
            if useLiveVideo { relay.connect() }
            updateVideoAvailability()
        }
        .onDisappear {
            session.emergencyStop(reason: "Dashboard closed"); relay.disconnect(reason: "dashboard disappeared"); session.controlsSuspended = false
        }
        .onChange(of: useLiveVideo) { _, live in
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
                if useLiveVideo { relay.connect() }
            case .inactive:
                // Pause commands immediately without canceling the tracking session.
                // Returning to active requires neutral hands, never a held gesture.
                experience.hands.requireNeutralReset(model: session)
                relay.stopRobot()
            case .background:
                session.emergencyStop(reason: "App moved to background")
                relay.disconnect(reason: "scene backgrounded")
            @unknown default:
                session.emergencyStop(reason: "Unknown scene state"); relay.stopRobot()
            }
        }
        .task {
            while !Task.isCancelled {
                session.tick()
                do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
            }
        }
        .onChange(of: panel) { _, panel in
            session.controlsSuspended = panel != nil
            if panel != nil { session.halt() }
        }
    }

    private var cameraBackground: some View {
        ZStack {
            Color.black
            if useLiveVideo {
                if let frame = relay.latestFrame {
                    Image(decorative: frame, scale: 1)
                        .resizable().scaledToFit()
                        .opacity(relay.hasFreshFrame ? 1 : 0.35)
                        .frame(width: 1280, height: 800)
                }
                if !relay.hasFreshFrame {
                    VStack(spacing: 10) {
                        Image(systemName: "video.slash").font(.title)
                        Text(relay.status).font(.headline)
                        Text(relay.isConfigured ? "The Pi must stream to the same relay room." : "Open Camera settings for setup.")
                            .font(.caption).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                Image("DemoTable").resizable().scaledToFill()
                    .frame(width: 1280, height: 800).clipped()
                    .opacity(demoVideoAvailable ? 1 : 0.35)
                if !demoVideoAvailable {
                    Label("Demo video unavailable", systemImage: "video.slash")
                        .font(.headline).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityLabel(useLiveVideo ? "Robot camera: \(relay.status)" : "Illustrative demo camera photo")
    }

    private var header: some View {
        HStack {
            HStack(spacing: 10) {
                Image(systemName: "circle.hexagongrid.fill").foregroundStyle(mint)
                Text("centerpiece").font(.system(size: 16, weight: .semibold, design: .rounded))
                Divider().frame(height: 16)
                Text("Hot Seat").font(.system(size: 12)).foregroundStyle(.secondary)
            }.padding(.horizontal, 16).frame(height: 44).glassPanel(radius: 24)
            Spacer()
            Button(action: onExitImmersive) {
                Label("Exit immersive", systemImage: "arrow.down.right.and.arrow.up.left")
                    .font(.system(size: 11, weight: .medium))
                    .padding(.horizontal, 14).frame(height: 44).glassPanel(radius: 24)
            }.buttonStyle(.plain).hoverEffect(.highlight)
            Button { panel = .connection } label: {
                HStack(spacing: 10) {
                    Image(systemName: useLiveVideo ? "video.fill" : "photo")
                    VStack(alignment: .leading, spacing: 2) {
                        Text("ROBOT CAM 01").font(.system(size: 10, weight: .semibold)).tracking(1)
                        Text(useLiveVideo ? relay.status : "Demo photo · controls mocked")
                            .font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                    Circle().fill(useLiveVideo && relay.hasFreshFrame ? mint : .orange).frame(width: 6, height: 6)
                }.padding(.horizontal, 14).frame(height: 44).glassPanel(radius: 24)
            }.buttonStyle(.plain).hoverEffect(.highlight).accessibilityLabel("Camera settings")
        }
    }

    private var playerRail: some View {
        VStack(spacing: 14) {
            Text("PLAYERS").font(.system(size: 9, weight: .semibold)).tracking(1.6).foregroundStyle(.secondary)
            ForEach(Player.samples) { player in
                let selected = player.id == session.selectedPlayerID
                Button { session.selectPlayer(player) } label: {
                    VStack(spacing: 6) {
                        ProfilePhoto(playerID: player.id, size: 44)
                            .padding(3)
                            .overlay(Circle().stroke(selected ? mint : .white.opacity(0.3), lineWidth: selected ? 2 : 1))
                            .overlay(alignment: .bottomTrailing) {
                                if selected {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 15)).foregroundStyle(.black, mint)
                                }
                            }
                        Text(player.name).font(.system(size: 11, weight: selected ? .semibold : .regular))
                            .foregroundStyle(selected ? mint : .white)
                    }.frame(width: 56).padding(.vertical, 3).contentShape(Rectangle())
                }
                .buttonStyle(.plain).hoverEffect(.highlight)
                .disabled(session.isDriving || session.isBusy)
                .accessibilityLabel("Select \(player.name)")
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }.padding(12).glassPanel()
    }

    private var questionPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("FOR \(session.selectedPlayer?.name.uppercased() ?? "YOUR PLAYER")")
                .font(.system(size: 10, weight: .bold)).tracking(1.4).foregroundStyle(mint)
            Text("Pick their next question").font(.system(size: 20, weight: .semibold))
            Text("Choose one, then position the robot.").font(.system(size: 11)).foregroundStyle(.secondary)
            if let player = session.selectedPlayer {
                ForEach(Array(player.questions.enumerated()), id: \.offset) { index, question in
                    let selected = session.selectedQuestionIndex == index
                    Button { session.selectQuestion(index) } label: {
                        HStack(spacing: 10) {
                            Text(String(format: "%02d", index + 1)).font(.system(size: 11).monospacedDigit())
                                .foregroundStyle(selected ? mint : .secondary)
                            Text(question).font(.system(size: 13, weight: .medium)).multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 19)).foregroundStyle(selected ? mint : .white.opacity(0.45))
                        }.padding(12).frame(minHeight: 68)
                        .background(selected ? mint.opacity(0.15) : .white.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected ? mint : .white.opacity(0.25), lineWidth: 1))
                        .contentShape(RoundedRectangle(cornerRadius: 14))
                    }.buttonStyle(.plain).hoverEffect(.highlight)
                        .accessibilityAddTraits(selected ? [.isSelected] : [])
                }
            }
            Divider().padding(.top, 4)
            HStack {
                Text(session.selection == nil ? "Choose a question" : "Selected for \(session.selectedPlayer?.name ?? "player")")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
                Spacer(minLength: 6)
                Button { session.enterDriving() } label: {
                    HStack(spacing: 6) { Text("Ready to drive"); Image(systemName: "arrow.right") }
                        .font(.system(size: 11, weight: .semibold)).padding(.vertical, 4)
                }.buttonStyle(.borderedProminent).tint(mint).foregroundStyle(.black)
                    .disabled(session.selection == nil)
            }
        }.padding(18).frame(width: 310).glassPanel()
    }

    private var transcriptPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 9) {
                Image(systemName: "waveform").font(.title3).foregroundStyle(mint)
                Text("Transcript").font(.system(size: 18, weight: .semibold))
                Spacer()
                Text("Demo").font(.system(size: 9)).padding(.horizontal, 9).padding(.vertical, 4)
                    .overlay(Capsule().stroke(.white.opacity(0.3)))
            }
            Text("Table conversation").font(.system(size: 11)).foregroundStyle(.secondary)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    transcript("Jordan", "00:42", "If we could go anywhere this weekend, where would we go?")
                    Divider()
                    transcript("Maya", "00:48", "Somewhere with mountains. I’ve always wanted to try climbing outdoors.")
                    Divider()
                    transcript("Alex", "00:55", "I’d choose the coast. A beach trip sounds pretty good.")
                    Divider()
                    transcript("Sam", "01:02", "Can we build a tiny cabin and do both?")
                }
            }.frame(maxHeight: 330)
            Text("Sample conversation").font(.system(size: 10)).foregroundStyle(.secondary)
        }.padding(18).frame(width: 280).glassPanel()
    }

    private func transcript(_ name: String, _ time: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(name).font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(name == session.selectedPlayer?.name ? mint : .white)
                Spacer()
                Text(time).font(.system(size: 10).monospacedDigit()).foregroundStyle(.secondary)
            }
            Text(text).font(.system(size: 12)).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var drivingPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("FOR \(session.selectedPlayer?.name.uppercased() ?? "PLAYER")")
                    .font(.system(size: 10, weight: .bold)).tracking(1.3).foregroundStyle(mint)
                Spacer()
                Text(useLiveVideo ? "Live wheel control" : "Demo movement").font(.system(size: 10)).foregroundStyle(.secondary)
            }
            Text(session.selection?.question ?? "Selected question").font(.system(size: 14, weight: .medium))
            if session.phase == .ready {
                HandMotionControls(session: session, hands: experience.hands, isLive: useLiveVideo,
                                   connectionAvailable: !useLiveVideo || relay.canControlRobot,
                                   blockReason: useLiveVideo ? (relay.controlBlockReason ?? session.driveBlockReason) : nil)
                Divider()
                if session.armed {
                    CapsuleDropControl(session: session)
                } else {
                    Button { session.arm() } label: {
                        Label("Arm capsule drop", systemImage: "shippingbox")
                            .font(.system(size: 12, weight: .medium))
                            .frame(maxWidth: .infinity).frame(height: 30)
                    }
                    .disabled(!session.canArm)
                    Text("Release both drive pinches before arming.")
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                }
                HStack {
                    Text(session.armed ? "ARMED" : "DROP DISARMED")
                        .font(.system(size: 9, weight: .bold)).tracking(1)
                        .foregroundStyle(session.armed ? mint : .secondary)
                    Spacer()
                    Button(role: .destructive) { session.emergencyStop() } label: {
                        Label("Stop", systemImage: "stop.fill")
                    }.font(.system(size: 12))
                }
            } else if session.isBusy {
                HStack { ProgressView(); Text(session.phase.rawValue).font(.caption) }
                Button("Stop", role: .destructive) { session.emergencyStop() }
            } else {
                if session.phase == .stopped && !session.roundInProgress {
                    Button("Resume positioning") { session.resumePositioning() }
                }
                Button("Finish round") { session.finishRound() }
            }
            Text(session.status).font(.system(size: 11)).foregroundStyle(.secondary)
            Text(session.handDrivingStatus)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(session.handDrivingEnabled ? mint : .orange)
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            HStack {
                if !session.roundInProgress {
                    Button("Change question") { session.editSelection() }.disabled(session.isBusy)
                }
                Spacer()
                Button("Page preview") { panel = .sharedPage }
            }.font(.system(size: 10))
        }.padding(18).frame(width: 310).glassPanel()
    }

    private var connectionPanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Camera & demo settings").font(.title2)
            Toggle("Live relay video", isOn: $experience.useLiveVideo)
            Text(useLiveVideo ? relay.status : "Showing an illustrative photo, not live video.").font(.subheadline)
            if !relay.isConfigured {
                Text("Add RELAY_TOKEN to apple-vision/.env, then rebuild and run from Xcode.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if useLiveVideo {
                Text("Room: \(relay.room) · JPEG frames: \(relay.framesReceived)").font(.caption.monospacedDigit())
                Text("Peers: \(relay.peers.isEmpty ? "none" : relay.peers.joined(separator: ", "))").font(.caption)
                Text("Wheel control: \(relay.controlBlockReason ?? "ready")").font(.caption)
                    .foregroundStyle(relay.controlBlockReason == nil ? mint : .orange)
                Button("Reconnect") { relay.reconnect() }.disabled(!relay.isConfigured)
            } else {
                Toggle("Demo video available", isOn: $experience.demoVideoAvailable)
            }
            Divider()
            Text("Wheel commands are live in relay mode. Capsule actions and transcript are simulated.").font(.caption).foregroundStyle(.secondary)
            Picker("Next demo drop failure", selection: $session.failure) {
                ForEach(DemoFailure.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }.disabled(session.isBusy)
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(session.events.enumerated()), id: \.offset) { _, event in Text(event) }
                }.font(.caption).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(height: 100)
            Button("Done") { panel = nil }
        }.padding(30).frame(width: 520)
    }

    private var sharedPage: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Shared capsule page").font(.title2)
            Text("Local preview · every tag opens the same URL").font(.caption).foregroundStyle(.secondary)
            if let question = session.activeQuestion {
                Text("For \(question.playerName)").foregroundStyle(mint)
                Text(question.question).font(.title3)
            } else { Text("No question assigned yet.") }
            Button("Done") { panel = nil }
        }.padding(30).frame(width: 480)
    }

    private func updateVideoAvailability() {
        guard session.cameraAvailable != videoAvailable else { return }
        session.cameraAvailable = videoAvailable
        session.cameraChanged()
    }


}

/// Display crops of the generated demo photo, not real player identity data.
private struct ProfilePhoto: View {
    let playerID: Int
    let size: CGFloat
    private var crop: CGRect {
        [CGRect(x: 565, y: 20, width: 230, height: 230),
         CGRect(x: 835, y: 75, width: 180, height: 180),
         CGRect(x: 1045, y: 95, width: 190, height: 190),
         CGRect(x: 1280, y: 80, width: 190, height: 190)][playerID % 4]
    }
    var body: some View {
        let scale = size / crop.width
        Image("DemoTable").resizable()
            .frame(width: 1536 * scale, height: 1024 * scale)
            .offset(x: -crop.minX * scale, y: -crop.minY * scale)
            .frame(width: size, height: size, alignment: .topLeading)
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
}

private extension View {
    func glassPanel(radius: CGFloat = 22) -> some View {
        self.background(.black.opacity(0.22), in: RoundedRectangle(cornerRadius: radius))
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(.white.opacity(0.24), lineWidth: 0.75))
            .shadow(color: .black.opacity(0.15), radius: 15, y: 6)
    }
}

#Preview {
    DashboardView(session: DemoSession(), experience: ImmersiveExperience()).preferredColorScheme(.dark)
}
