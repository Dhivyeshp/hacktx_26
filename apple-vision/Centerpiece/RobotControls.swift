import SwiftUI

private let controlMint = Color(red: 0.65, green: 0.94, blue: 0.79)

/// Shows ARKit's observed hand state. These are free-space gestures, not drags on a view.
struct HandMotionControls: View {
    @Bindable var session: DemoSession
    @Bindable var hands: HandMotionController
    var isLive: Bool
    var connectionAvailable: Bool
    var blockReason: String?

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 18) {
                hand("Left", tracked: hands.leftTracked, pinched: hands.leftPinched)
                hand("Right", tracked: hands.rightTracked, pinched: hands.rightPinched)
            }.frame(maxWidth: .infinity)
            HStack(spacing: 6) {
                direction("Left", icon: "arrow.turn.up.left", value: .left)
                direction("Straight", icon: "arrow.up", value: .straight)
                direction("Right", icon: "arrow.turn.up.right", value: .right)
            }
            Text(hands.status).font(.system(size: 11, weight: .medium))
                .foregroundStyle(session.handDrivingEnabled ? controlMint : .secondary)
                .multilineTextAlignment(.center).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 7) {
                Text("Pinch your thumb to your middle finger.").fontWeight(.semibold)
                Text("Both hands → straight\nLeft only → left\nRight only → right\nRelease both → stop")
                    .foregroundStyle(.secondary).lineSpacing(4)
            }.font(.system(size: 11)).frame(maxWidth: .infinity, alignment: .leading)
            Button {
                session.enableHandDriving()
            } label: {
                Label(session.handDrivingEnabled ? "Hand driving enabled" : "Enable hand driving",
                      systemImage: session.handDrivingEnabled ? "checkmark" : "hand.raised.fingers.spread.fill")
                    .font(.system(size: 12, weight: .medium)).frame(maxWidth: .infinity).frame(height: 30)
            }
            // Enabling must not turn into Pause under the same gaze target:
            // another selection while starting a gesture could disable driving.
            // The separate Stop control remains available.
            .disabled(session.handDrivingEnabled || !session.canDrive || !connectionAvailable)
            if isLive, let blockReason {
                Text("Wheels idle · \(blockReason)")
                    .font(.system(size: 10)).foregroundStyle(.orange)
                    .multilineTextAlignment(.center).frame(maxWidth: .infinity)
            }
            HStack {
                Text(isLive ? "LIVE WHEELS" : "DEMO WHEELS").foregroundStyle(isLive ? controlMint : .secondary)
                Spacer()
                Text(String(format: "L %.2f  R %.2f", session.wheelCommand.left, session.wheelCommand.right))
                    .monospacedDigit()
            }.font(.system(size: 9, weight: .semibold))
        }
    }

    private func hand(_ title: String, tracked: Bool, pinched: Bool) -> some View {
        VStack(spacing: 6) {
            Image(systemName: pinched ? "hand.pinch.fill" : "hand.raised.fill")
                .font(.system(size: 28)).foregroundStyle(pinched ? controlMint : .white.opacity(tracked ? 0.8 : 0.25))
            Text(title).font(.system(size: 10, weight: .semibold))
            Text(tracked ? pinched ? "Pinched" : "Open" : "Not tracked")
                .font(.system(size: 9)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
    }

    private func direction(_ title: String, icon: String, value: HandDriveIntent) -> some View {
        let active = hands.intent == value
        return VStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 14))
            Text(title).font(.system(size: 9))
        }
        .foregroundStyle(active ? controlMint : .secondary)
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(active ? controlMint.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 10))
    }
}

/// Native pinch-and-hold recognition triggers once; a short pinch never dispenses.
struct CapsuleDropControl: View {
    @Bindable var session: DemoSession
    @GestureState private var pressing = false
    @State private var holdStarted: Date?
    @State private var armedAtStart: UUID?
    private let duration = 0.8

    var body: some View {
        TimelineView(.animation(paused: !pressing)) { context in
            let progress = holdStarted.map { min(1, max(0, context.date.timeIntervalSince($0) / duration)) } ?? 0
            HStack(spacing: 10) {
                Image(systemName: "shippingbox.fill")
                Text(pressing ? "Keep holding…" : "Pinch & hold to drop")
                    .font(.system(size: 12, weight: .semibold))
                Spacer(minLength: 0)
                ZStack {
                    Circle().stroke(.black.opacity(0.16), lineWidth: 2)
                    Circle().trim(from: 0, to: progress)
                        .stroke(.black.opacity(0.8), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }.frame(width: 18, height: 18)
            }
            .padding(.horizontal, 15).frame(height: 52)
            .foregroundStyle(.black)
            .background(controlMint.opacity(session.canDrop ? 1 : 0.3), in: Capsule())
            .contentShape(Capsule())
        }
        .hoverEffect(.highlight)
        .gesture(LongPressGesture(minimumDuration: duration, maximumDistance: 22)
            .updating($pressing) { value, state, _ in state = value }
            .onEnded { completed in
                guard completed, let armedAtStart else { return }
                session.drop(armedWith: armedAtStart)
            }, including: session.canDrop ? .all : .none)
        .onChange(of: pressing) { _, value in
            holdStarted = value && session.canDrop ? Date() : nil
            if value, session.canDrop { armedAtStart = session.armingID }
            // The system may reset GestureState before delivering onEnded.
            // Keep the captured arming until completion/cancellation is resolved;
            // canDrop and the arming ID reject an interrupted or stale callback.
        }
        .onChange(of: session.canDrop) { _, available in
            if !available { holdStarted = nil; armedAtStart = nil }
        }
        .onDisappear { holdStarted = nil; armedAtStart = nil }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Drop one capsule")
        .accessibilityHint("Arm first, then pinch and hold for eight tenths of a second. Releasing early cancels.")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: Text("Drop one capsule")) {
            if let id = session.armingID { session.drop(armedWith: id) }
        }
    }
}
