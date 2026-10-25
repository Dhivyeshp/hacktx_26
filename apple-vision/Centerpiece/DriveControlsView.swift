import SwiftUI

/// Driving and dropping, once a prompt is assigned. The hand recognition and
/// the drop gesture are the existing controls from `RobotControls.swift`; this
/// view only frames them with who the capsule is for and what is blocking.
struct DriveControlsView: View {
    @Bindable var session: DemoSession
    @Bindable var experience: ImmersiveExperience
    let round: Round
    let targetName: String
    var onDelivered: () -> Void
    var onPreview: () -> Void

    private var relay: RelayClient { experience.relay }
    private var useLiveVideo: Bool { experience.useLiveVideo }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow("Deliver to \(targetName)", tint: Destina.tan)
                    Text(round.recommendation.title)
                        .font(Destina.heading(24))
                        .foregroundStyle(Destina.text)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 10)
                Text(useLiveVideo ? "Live wheels" : "Demo movement")
                    .font(Destina.ui(11))
                    .foregroundStyle(useLiveVideo ? Destina.sage : Destina.textMuted)
            }
            Rectangle().fill(Destina.line).frame(height: 1)
            if session.phase == .ready {
                HandMotionControls(
                    session: session,
                    hands: experience.hands,
                    isLive: useLiveVideo,
                    connectionAvailable: !useLiveVideo || relay.canControlRobot,
                    blockReason: useLiveVideo ? (relay.controlBlockReason ?? session.driveBlockReason) : nil
                )
                Rectangle().fill(Destina.line).frame(height: 1)
                if session.armed {
                    CapsuleDropControl(session: session)
                } else {
                    Button("Arm capsule drop") { session.arm() }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(!session.canArm)
                    Text("Open both hands before arming. Movement disarms the drop.")
                        .font(Destina.ui(10))
                        .foregroundStyle(Destina.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    Text(session.armed ? "ARMED" : "DROP DISARMED")
                        .font(Destina.ui(9, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(session.armed ? Destina.tan : Destina.textMuted)
                    Spacer()
                    Button("Stop") { session.emergencyStop() }
                        .buttonStyle(.destinaDestructive)
                }
            } else if session.isBusy {
                HStack(spacing: 10) {
                    ProgressView().tint(Destina.tan)
                    Text(session.phase.rawValue)
                        .font(Destina.ui(12))
                        .foregroundStyle(Destina.textMuted)
                }
                Button("Stop") { session.emergencyStop() }
                    .buttonStyle(.destinaDestructive)
            } else {
                if session.phase == .stopped && !session.roundInProgress {
                    Button("Resume positioning") { session.resumePositioning() }
                        .buttonStyle(SecondaryButtonStyle())
                }
                if session.phase == .delivered {
                    Button("Record the outcome") { onDelivered() }
                        .buttonStyle(.destinaPrimary)
                }
            }
            Text(session.status)
                .font(Destina.ui(11))
                .foregroundStyle(Destina.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Text(session.handDrivingStatus)
                .font(Destina.ui(10, weight: .medium))
                .foregroundStyle(session.handDrivingEnabled ? Destina.sage : Destina.tan)
                .fixedSize(horizontal: false, vertical: true)
            Rectangle().fill(Destina.line).frame(height: 1)
            HStack(spacing: 12) {
                // Not every demo has a working dispenser. Recording the outcome
                // by hand keeps a round finishable without the hardware.
                Button("Skip to outcome") { onDelivered() }
                    .buttonStyle(SecondaryButtonStyle())
                Spacer()
                Button("Page preview", action: onPreview)
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .frame(width: 420, alignment: .leading)
        .destinaPanel()
        .onChange(of: session.phase) { _, phase in
            if phase == .delivered { onDelivered() }
        }
    }
}
