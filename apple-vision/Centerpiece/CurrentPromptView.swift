import SwiftUI

/// "On the table". The assigned prompt and the two ways a turn ends. Shown in
/// full while recording an outcome, and as a single line while driving so the
/// camera and the hand controls have the room.
struct CurrentPromptView: View {
    let round: Round
    let feed: GameMasterFeed?
    @Bindable var client: DestinaClient
    var compact: Bool
    var onPreview: () -> Void

    private var targetName: String {
        feed?.name(for: round.recommendation.targetPlayerID) ?? "the table"
    }

    var body: some View {
        if compact { compactRow } else { full }
    }

    private var compactRow: some View {
        HStack(spacing: 14) {
            Text(round.recommendation.type.rawValue.uppercased())
                .font(Destina.ui(10, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(Destina.ink)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(Destina.cream2)
            VStack(alignment: .leading, spacing: 2) {
                Text("Deliver to \(targetName)")
                    .font(Destina.ui(13, weight: .medium))
                    .foregroundStyle(Destina.text)
                Text(round.recommendation.title)
                    .font(Destina.heading(19))
                    .foregroundStyle(Destina.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 10)
            Button("Page preview", action: onPreview)
                .buttonStyle(SecondaryButtonStyle())
        }
    }

    private var full: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Eyebrow("On the table")
                Spacer()
                Text("Prompt \(String(format: "%02d", round.number))")
                    .font(Destina.ui(11).monospacedDigit())
                    .foregroundStyle(Destina.textMuted)
            }
            Text(round.recommendation.title)
                .font(Destina.heading(32))
                .foregroundStyle(Destina.text)
                .fixedSize(horizontal: false, vertical: true)
            Text(round.recommendation.instructions)
                .font(Destina.ui(14))
                .lineSpacing(3)
                .foregroundStyle(Destina.text)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 14) {
                Text("For \(feed.map { $0.names(for: round.recommendation) } ?? targetName)")
                    .font(Destina.ui(12, weight: .medium))
                    .foregroundStyle(Destina.textMuted)
                Text("\(round.recommendation.duration) seconds")
                    .font(Destina.ui(12).monospacedDigit())
                    .foregroundStyle(Destina.textMuted)
            }
            if round.recommendation.secret != nil {
                Label("A private mission is visible only to \(targetName).", systemImage: "lock")
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.textMuted)
            }
            Rectangle().fill(Destina.line).frame(height: 1)
            HStack(spacing: 12) {
                Button("Mark completed") {
                    Task { await client.clear(status: "completed") }
                }
                .buttonStyle(.destinaPrimary)
                .disabled(client.isBusy("clear"))
                Button("Pass this prompt") {
                    Task { await client.clear(status: "passed") }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(client.isBusy("clear"))
                Spacer()
                Button("Page preview", action: onPreview)
                    .buttonStyle(SecondaryButtonStyle())
            }
            Text("Passing is a normal outcome. No one has to explain it.")
                .font(Destina.ui(11))
                .foregroundStyle(Destina.textMuted)
        }
    }
}

/// What the player sees on their phone, so a Game Master can check it without
/// asking anyone to hand over a device. The private mission is not shown here.
struct PromptPreviewPanel: View {
    let round: Round?
    let feed: GameMasterFeed?
    let promptURL: URL?
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Eyebrow("Player view")
            if let round {
                Text(round.recommendation.type.rawValue.lowercased())
                    .font(Destina.wordmark(46))
                    .foregroundStyle(Destina.ink)
                Text(round.recommendation.title)
                    .font(Destina.heading(28))
                    .fixedSize(horizontal: false, vertical: true)
                Text(round.recommendation.instructions)
                    .font(Destina.ui(15))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                Text(feed.map { "For \($0.names(for: round.recommendation))" } ?? "")
                    .font(Destina.ui(12, weight: .medium))
                    .foregroundStyle(Destina.inkMuted)
                if round.recommendation.secret != nil {
                    Text("The private mission appears only on the phone it names. It is not shown here.")
                        .font(Destina.ui(11))
                        .foregroundStyle(Destina.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text("No prompt is on the table.")
                    .font(Destina.heading(26))
            }
            if let promptURL {
                Text(promptURL.absoluteString)
                    .font(Destina.ui(11).monospacedDigit())
                    .foregroundStyle(Destina.inkMuted)
            }
            Button("Done", action: onClose)
                .buttonStyle(.destinaPrimary)
        }
        .frame(width: 520, alignment: .leading)
        .destinaCreamPanel(30)
    }
}
