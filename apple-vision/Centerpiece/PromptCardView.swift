import SwiftUI

/// One recommendation. The reason line matters as much as the prompt: it is
/// the grounding the server validated the suggestion against, and it is what a
/// Game Master uses to judge whether the pick suits the table.
struct PromptCardView: View {
    let recommendation: Recommendation
    let feed: GameMasterFeed?
    let isUsable: Bool
    let isAssigning: Bool
    var onUse: () -> Void
    var onEdit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(recommendation.type.rawValue.uppercased())
                    .font(Destina.ui(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Destina.ink)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Destina.cream2)
                Spacer()
                Text("\(recommendation.duration)s")
                    .font(Destina.ui(10).monospacedDigit())
                    .foregroundStyle(Destina.inkMuted)
            }
            Text(recommendation.title)
                .font(Destina.heading(25))
                .fixedSize(horizontal: false, vertical: true)
            Text(recommendation.instructions)
                .font(Destina.ui(13))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            if let feed {
                Text(feed.names(for: recommendation))
                    .font(Destina.ui(11, weight: .medium))
                    .foregroundStyle(Destina.inkMuted)
            }
            if recommendation.secret != nil {
                Label("Carries a private mission", systemImage: "lock")
                    .font(Destina.ui(10))
                    .foregroundStyle(Destina.inkMuted)
            }
            Rectangle().fill(Destina.lineLight).frame(height: 1)
            Text(recommendation.reason)
                .font(Destina.ui(11))
                .foregroundStyle(Destina.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if recommendation.isFromLibrary {
                Text("From the question library")
                    .font(Destina.ui(10))
                    .foregroundStyle(Destina.inkMuted)
            }
            if isUsable {
                // Stacked, not side by side: at card width the two labels
                // squeeze until the second one has no room to render.
                VStack(spacing: 8) {
                    Button("Use this prompt", action: onUse)
                        .buttonStyle(.destinaPrimary)
                        .disabled(isAssigning)
                    Button("Edit wording", action: onEdit)
                        .buttonStyle(.destinaSecondaryOnCream)
                        .disabled(isAssigning)
                }
                .frame(maxWidth: .infinity)
            } else {
                Text("Saved from an earlier set. Generate again to pick from new options.")
                    .font(Destina.ui(10))
                    .foregroundStyle(Destina.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(width: 222, alignment: .leading)
        .frame(minHeight: 260, alignment: .top)
        .destinaCreamPanel(16)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(recommendation.type.rawValue) prompt, \(recommendation.title)")
    }
}

/// Editing wording before assigning. The server rejects anything under 15
/// characters, so the action stays disabled until the text can be accepted.
struct PromptEditSheet: View {
    let recommendation: Recommendation
    let participantNames: String
    @Binding var instructions: String
    var isAssigning: Bool
    var onCancel: () -> Void
    var onAssign: (String) -> Void

    private var trimmed: String {
        instructions.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var isValid: Bool { trimmed.count >= 15 && trimmed.count <= 1200 }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(recommendation.type.rawValue)
                Text(recommendation.title)
                    .font(Destina.heading(30))
                    .foregroundStyle(Destina.text)
                Text("For \(participantNames)")
                    .font(Destina.ui(12))
                    .foregroundStyle(Destina.textMuted)
            }
            TextEditor(text: $instructions)
                .font(Destina.ui(15))
                .scrollContentBackground(.hidden)
                .frame(height: 170)
                .padding(10)
                .background(Destina.bgRaised)
                .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
                .onChange(of: instructions) { _, value in
                    if value.count > 1200 { instructions = String(value.prefix(1200)) }
                }
            HStack {
                Text("\(trimmed.count) of 1200 characters")
                    .font(Destina.ui(11).monospacedDigit())
                    .foregroundStyle(Destina.textMuted)
                Spacer()
                Button("Cancel", action: onCancel)
                    .buttonStyle(SecondaryButtonStyle())
                Button("Use this prompt") { onAssign(instructions) }
                    .buttonStyle(.destinaPrimary)
                    .disabled(!isValid || isAssigning)
            }
            if !isValid {
                Text("Write at least 15 characters before using this prompt.")
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.tanHover)
            }
            if recommendation.secret != nil {
                Text("The private mission is not edited here. It stays with the person it names.")
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(width: 560, alignment: .leading)
        .destinaPanel(28)
    }
}
