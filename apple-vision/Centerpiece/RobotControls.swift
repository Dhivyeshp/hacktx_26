import SwiftUI

private let controlMint = Color(red: 0.65, green: 0.94, blue: 0.79)

/// Uses the system's indirect pinch-and-drag. GestureState resets on release AND cancellation.
/// No camera access, hand skeleton, or immersive space is needed.
struct RobotDriveControls: View {
    @Bindable var session: DemoSession
    @GestureState private var translation: CGSize?
    @State private var input = DriveInput.zero

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(.white.opacity(0.055))
                Circle().stroke(.white.opacity(0.16), lineWidth: 1)
                Circle().stroke(controlMint.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [3, 5]))
                    .padding(25)
                VStack {
                    Image(systemName: "arrow.up").padding(.top, 9)
                    Spacer()
                    Text("RELEASE TO STOP").font(.system(size: 7, weight: .semibold)).tracking(1).padding(.bottom, 13)
                }.foregroundStyle(.white.opacity(0.45))
                HStack {
                    Image(systemName: "arrow.turn.up.left").padding(.leading, 9)
                    Spacer()
                    Image(systemName: "arrow.turn.up.right").padding(.trailing, 9)
                }.foregroundStyle(.white.opacity(0.45))
                Circle()
                    .fill(controlMint.gradient)
                    .frame(width: 48, height: 48)
                    .overlay(Image(systemName: "hand.pinch.fill").foregroundStyle(.black.opacity(0.7)))
                    .shadow(color: controlMint.opacity(0.15), radius: 12)
                    .offset(input.offset)
            }
            .font(.system(size: 13))
            .frame(width: 172, height: 172)
            .contentShape(Circle())
            .hoverEffect(.highlight)
            .gesture(DragGesture(minimumDistance: 3, coordinateSpace: .local)
                .updating($translation) { value, state, _ in state = value.translation })
            .opacity(session.canDrive ? 1 : 0.4)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Drive robot")
            .accessibilityHint("Look at the center and pinch and drag up to drive forward, left or right to turn. Release to stop.")
            .onChange(of: translation) { previous, value in
                guard let value else { input = .zero; session.endDrive(); return }
                if previous == nil { session.beginDrive() }
                input = DriveInput(translation: value)
                session.updateDrive(input)
            }
            .onChange(of: session.canDrive) { _, available in
                if !available { input = .zero; session.halt() }
            }
            .task(id: translation != nil) {
                guard translation != nil, session.canDrive,
                      let gestureID = session.beginDrive() else { return }
                // Repeat the current command while the same system gesture is held,
                // including when the hand is stationary. Never restart after interruption
                // until a fresh gesture begins.
                defer { session.endDrive(gestureID: gestureID) }
                while !Task.isCancelled, session.driveGestureID == gestureID, session.canDrive {
                    session.updateDrive(input, gestureID: gestureID)
                    do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
                }
            }
            .onDisappear { input = .zero; session.halt() }

            HStack(spacing: 6) {
                Circle().fill(session.isMoving ? controlMint : .white.opacity(0.4)).frame(width: 5, height: 5)
                Text(session.motionLabel).font(.system(size: 11, weight: .medium))
            }
            HStack(spacing: 18) {
                wheel("L", value: session.wheelCommand.left)
                wheel("R", value: session.wheelCommand.right)
            }
            Text("Pinch the puck. Drag up to drive, sideways to turn.")
                .font(.system(size: 10)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity)
    }

    private func wheel(_ name: String, value: Float) -> some View {
        HStack(spacing: 4) {
            Text(name).foregroundStyle(.secondary)
            Text(String(format: "%+.0f%%", value * 100)).monospacedDigit()
        }.font(.system(size: 10))
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
