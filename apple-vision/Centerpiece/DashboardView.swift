import SwiftUI

private let mint = Color(red: 0.65, green: 0.94, blue: 0.79)
private let lavender = Color(red: 0.78, green: 0.73, blue: 1)

struct DashboardView: View {
    @State private var session = DemoSession()
    @State private var showingConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            header
            HStack(alignment: .top, spacing: 22) {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        eyebrow("AT THE TABLE")
                        Spacer()
                        Label("Camera preview", systemImage: "video")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    RobotPreview(progress: session.progress, paused: session.cameraPaused)
                        .frame(height: 230)
                    HStack {
                        Label("Robot camera · simulated", systemImage: "circle.inset.filled")
                            .font(.caption).foregroundStyle(mint)
                        Spacer()
                        Button {
                            session.cameraPaused.toggle()
                        } label: {
                            Image(systemName: session.cameraPaused ? "play.fill" : "pause.fill")
                        }
                        .accessibilityLabel(session.cameraPaused ? "Resume camera preview" : "Pause camera preview")
                    }
                    Divider()
                    tableBalance
                }
                .padding(22)
                .frame(width: 340)
                .background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 26))

                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        VStack(alignment: .leading, spacing: 6) {
                            eyebrow("THE NEXT MOMENT")
                            Text("Bring someone into the game.")
                                .font(.title2.weight(.semibold))
                        }
                        Spacer()
                        Text("3 suggestions").font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(Challenge.samples) { challenge in
                        challengeCard(challenge)
                    }
                }
            }
            statusBar
            footer
        }
        .padding(32)
        .frame(width: 1180)
        .background {
            LinearGradient(colors: [Color(red: 0.09, green: 0.14, blue: 0.16),
                                    Color(red: 0.08, green: 0.09, blue: 0.14)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .glassBackgroundEffect()
        .confirmationDialog("Deliver \(session.selected.kind.lowercased()) to \(session.selected.target)?",
                            isPresented: $showingConfirmation, titleVisibility: .visible) {
            Button("Confirm demo delivery") { session.deliver() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This is an offline simulation. No robot will move.")
        }
        .onDisappear { session.stop() }
    }

    private var header: some View {
        HStack(spacing: 16) {
            Image(systemName: "circle.hexagongrid.fill")
                .font(.system(size: 28)).foregroundStyle(mint)
                .frame(width: 56, height: 56)
                .background(mint.opacity(0.10), in: RoundedRectangle(cornerRadius: 18))
            VStack(alignment: .leading, spacing: 3) {
                Text("centerpiece").font(.system(size: 30, weight: .semibold, design: .rounded))
                Text("A little nudge. A better night.").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Label("Offline demo", systemImage: "testtube.2")
                .font(.subheadline).foregroundStyle(mint)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(mint.opacity(0.08), in: Capsule())
            Divider().frame(height: 34).padding(.horizontal, 10)
            VStack(alignment: .trailing, spacing: 4) {
                Text("ROUND 01 / 04").font(.caption.weight(.semibold)).tracking(2)
                Text("You’re the Game Master").font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    private var tableBalance: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Room to connect").font(.headline)
                Spacer()
                Text("Sample talk time").font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(Array(zip(["Maya", "Jordan", "Alex", "Sam"], [6, 38, 32, 24])), id: \.0) { name, share in
                HStack(spacing: 12) {
                    Text(name).font(.subheadline).frame(width: 54, alignment: .leading)
                    GeometryReader { geometry in
                        Capsule().fill(.white.opacity(0.07))
                        Capsule().fill(name == "Maya" ? mint : .white.opacity(0.3))
                            .frame(width: max(8, geometry.size.width * Double(share) / 45))
                    }
                    .frame(height: 5)
                    Text("\(share)%").font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary).frame(width: 32, alignment: .trailing)
                }
            }
            Text("A quieter voice could lead the next round.")
                .font(.caption).foregroundStyle(mint).padding(.top, 2)
        }
    }

    private func challengeCard(_ challenge: Challenge) -> some View {
        let selected = session.selectedID == challenge.id
        let accent = challenge.id == 0 ? mint : challenge.id == 1 ? Color.orange : lavender
        return Button {
            session.selectedID = challenge.id
        } label: {
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: challenge.symbol)
                    .font(.title3).foregroundStyle(accent)
                    .frame(width: 44, height: 44)
                    .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(challenge.kind).font(.caption2.weight(.bold)).tracking(1.8).foregroundStyle(accent)
                        if challenge.id == 0 {
                            Text("TOP PICK").font(.system(size: 9, weight: .bold)).tracking(1)
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(mint.opacity(0.12), in: Capsule()).foregroundStyle(mint)
                        }
                        Spacer()
                        Text(challenge.duration).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(challenge.title).font(.title3.weight(.semibold))
                    HStack(spacing: 6) {
                        Text(challenge.target).fontWeight(.semibold)
                        Text("· \(challenge.partner)").foregroundStyle(.secondary)
                    }.font(.subheadline)
                    Text(challenge.reason).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true).lineSpacing(3)
                }
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? mint : .white.opacity(0.25))
                    .font(.title3).padding(.top, 3)
            }
            .padding(18)
            .background(selected ? mint.opacity(0.07) : .white.opacity(0.035), in: RoundedRectangle(cornerRadius: 22))
            .overlay {
                RoundedRectangle(cornerRadius: 22)
                    .strokeBorder(selected ? mint.opacity(0.65) : .white.opacity(0.08), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 22))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .disabled(!session.canSelect)
        .accessibilityLabel("\(challenge.kind), \(challenge.title), for \(challenge.target). \(challenge.reason)")
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private var statusBar: some View {
        HStack(spacing: 18) {
            Image(systemName: statusSymbol)
                .font(.title2).foregroundStyle(session.phase == .failed ? .orange : mint)
                .frame(width: 44)
            VStack(alignment: .leading, spacing: 6) {
                Text(session.phase.rawValue).font(.headline)
                Text(session.detail).font(.caption).foregroundStyle(.secondary)
                if session.isBusy {
                    ProgressView(value: session.progress).tint(mint).frame(maxWidth: 360)
                }
            }
            Spacer()
            if session.isBusy {
                Button(role: .destructive) { session.stop() } label: {
                    Label("Stop demo", systemImage: "stop.fill").padding(.horizontal, 12)
                }
                .tint(.red)
            } else if session.canSelect {
                Button { showingConfirmation = true } label: {
                    HStack(spacing: 12) {
                        Text("Deliver to \(session.selected.target)")
                        Image(systemName: "arrow.right")
                    }.font(.headline).padding(.horizontal, 12).padding(.vertical, 5)
                }
                .tint(mint).buttonStyle(.borderedProminent).foregroundStyle(.black)
            } else {
                Button { session.reset() } label: {
                    Label("Try another round", systemImage: "arrow.counterclockwise")
                }.tint(mint)
            }
        }
        .padding(20)
        .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 24))
        .animation(.easeInOut(duration: 0.2), value: session.phase)
    }

    private var footer: some View {
        HStack {
            Label("Look at a card and pinch to select", systemImage: "hand.pinch.fill")
            Spacer()
            Menu {
                Toggle("Simulate robot error", isOn: $session.simulateFailure)
                Toggle("Pause camera preview", isOn: $session.cameraPaused)
                Button("Reset demo", action: session.reset)
            } label: {
                Label("Demo controls", systemImage: "slider.horizontal.3")
            }
            .disabled(session.isBusy)
            Text("No server · No hardware connected").foregroundStyle(.tertiary)
        }
        .font(.caption).foregroundStyle(.secondary)
    }

    private var statusSymbol: String {
        switch session.phase {
        case .ready: "sparkle"
        case .sending: "arrow.up.circle"
        case .delivering: "shippingbox"
        case .complete: "checkmark.circle.fill"
        case .stopped: "stop.circle"
        case .failed: "exclamationmark.triangle"
        }
    }

    private func eyebrow(_ text: String) -> some View {
        Text(text).font(.system(size: 10, weight: .semibold)).tracking(2.5).foregroundStyle(.secondary)
    }
}

private struct RobotPreview: View {
    let progress: Double
    let paused: Bool
    @State private var frozenProgress = 0.0

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let visibleProgress = paused ? frozenProgress : progress
            ZStack {
                Color(red: 0.035, green: 0.065, blue: 0.075)
                Path { path in
                    for index in 0...10 {
                        let x = CGFloat(index) * width / 10
                        path.move(to: CGPoint(x: width / 2 + (x - width / 2) * 0.3, y: 30))
                        path.addLine(to: CGPoint(x: x, y: height))
                    }
                    for index in 1...7 {
                        let y = CGFloat(index) * height / 7
                        path.move(to: CGPoint(x: 0, y: y))
                        path.addLine(to: CGPoint(x: width, y: y))
                    }
                }.stroke(mint.opacity(0.08), lineWidth: 1)

                Ellipse().fill(.black.opacity(0.3)).frame(width: 240, height: 90).offset(y: 45)
                Ellipse().fill(Color(red: 0.15, green: 0.23, blue: 0.25))
                    .overlay(Ellipse().stroke(mint.opacity(0.3), lineWidth: 2))
                    .frame(width: 222, height: 106).offset(y: 26)
                ForEach(0..<6) { index in
                    let angle = Double(index) * .pi / 3 + visibleProgress * .pi / 3
                    Capsule()
                        .fill(index == 2 ? mint : lavender.opacity(0.7))
                        .frame(width: 27, height: 33)
                        .overlay(Capsule().stroke(.white.opacity(0.3)))
                        .overlay(Rectangle().fill(.black.opacity(0.2)).frame(height: 1))
                        .offset(x: cos(angle) * 82, y: sin(angle) * 33 + 13)
                }
                Path { path in
                    path.move(to: CGPoint(x: width * 0.76, y: height * 0.74))
                    path.addLine(to: CGPoint(x: width * 0.76, y: height * 0.28))
                    path.addLine(to: CGPoint(x: width * 0.5, y: height * 0.28))
                    path.addLine(to: CGPoint(x: width * 0.5, y: height * (0.35 + sin(visibleProgress * .pi) * 0.12)))
                }.stroke(Color.gray, style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round))
                Image(systemName: "arrow.down.left.and.arrow.up.right")
                    .font(.system(size: 27, weight: .bold)).foregroundStyle(.white.opacity(0.8))
                    .position(x: width * 0.5, y: height * (0.4 + sin(visibleProgress * .pi) * 0.12))
                VStack {
                    HStack {
                        Label(paused ? "PAUSED" : "SIMULATED VIEW", systemImage: paused ? "pause.circle.fill" : "video.fill")
                        Spacer()
                        Text("CAM 01")
                    }
                    Spacer()
                    HStack {
                        Text("CAROUSEL / 6 SLOTS")
                        Spacer()
                        Image(systemName: "viewfinder")
                    }
                }
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .tracking(1).foregroundStyle(.white.opacity(0.65)).padding(16)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .animation(.linear(duration: 0.2), value: visibleProgress)
        }
        .onChange(of: paused) { _, isPaused in
            if isPaused { frozenProgress = progress }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(paused ? "Simulated camera preview paused" : "Simulated six-slot carousel and robot arm. Not a real camera feed.")
    }
}

#Preview {
    DashboardView().preferredColorScheme(.dark)
}
