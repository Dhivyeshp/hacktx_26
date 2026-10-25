import SwiftUI

/// "Live conversation". The transcript, read through the time-series store
/// when it is configured, plus the speaker controls.
///
/// Speaker identity is never assigned automatically. Deepgram separates voices
/// but does not know names, so a hint is a question the Game Master answers.
struct ConversationPanel: View {
    @Bindable var client: DestinaClient
    @Bindable var store: GameMasterStore
    var compact = true

    private var feed: GameMasterFeed? { client.feed }
    private var conversation: ConversationFeed? { feed?.conversation }

    /// Prefer the paged transcript; fall back to the copy inside the feed so
    /// the panel is never empty just because the read endpoint is new.
    private var segments: [TranscriptSegment] {
        client.transcript.isEmpty ? (conversation?.segments ?? []) : client.transcript
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            Rectangle().fill(Destina.line).frame(height: 1)
            hints
            transcriptList
            if !compact { controls }
        }
        .frame(width: compact ? 310 : 620, alignment: .leading)
        .destinaPanel()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Eyebrow("Live conversation")
                Spacer()
                HStack(spacing: 7) {
                    StatusDot(ok: conversation?.status == "live")
                    Text(statusLabel)
                        .font(Destina.ui(11))
                        .foregroundStyle(Destina.textMuted)
                }
            }
            Text("What the table is saying")
                .font(Destina.heading(24))
                .foregroundStyle(Destina.text)
            Text(sourceLabel)
                .font(Destina.ui(11))
                .foregroundStyle(Destina.textMuted)
        }
    }

    private var statusLabel: String {
        switch conversation?.status {
        case "live": return "Listening"
        case "paused": return "Paused"
        default: return "Not listening"
        }
    }

    private var sourceLabel: String {
        let count = segments.count
        guard count > 0 else {
            return "Nothing recorded yet. Tina or a phone does the listening."
        }
        let where_ = client.transcriptSource == "tigerdb" ? "the TigerDB store" : "this session"
        return "\(count) segments from \(where_)."
    }

    @ViewBuilder
    private var hints: some View {
        if let hints = conversation?.speakerHints, !hints.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Eyebrow("A voice to a name", tint: Destina.tan)
                ForEach(hints.prefix(compact ? 1 : 3)) { hint in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Was this \(hint.name)?")
                            .font(Destina.ui(13, weight: .medium))
                            .foregroundStyle(Destina.text)
                        Text("“\(hint.excerpt)”")
                            .font(Destina.ui(12))
                            .foregroundStyle(Destina.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 10) {
                            Button("Yes, that is \(hint.name)") {
                                Task {
                                    await client.mapSpeaker(label: hint.speakerLabel, playerID: hint.playerId)
                                }
                            }
                            .buttonStyle(.destinaPrimary)
                            Button("Keep unknown") {
                                Task {
                                    await client.mapSpeaker(
                                        label: hint.speakerLabel,
                                        playerID: nil,
                                        dismissRoundID: hint.roundId
                                    )
                                }
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                    .destinaInset()
                }
            }
        }
    }

    private var transcriptList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(segments.suffix(compact ? 40 : 120)) { segment in
                        row(segment).id(segment.id)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: compact ? 300 : 420)
            .onChange(of: segments.last?.id) { _, id in
                guard let id else { return }
                withAnimation { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
    }

    private func row(_ segment: TranscriptSegment) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(client.speakerName(for: segment) ?? segment.speakerLabel ?? "Unknown voice")
                    .font(Destina.ui(12, weight: .medium))
                    .foregroundStyle(client.speakerName(for: segment) == nil ? Destina.textMuted : Destina.text)
                if segment.isTestText {
                    Text("Test text")
                        .font(Destina.ui(9))
                        .foregroundStyle(Destina.textMuted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
                }
                Spacer()
                Text(time(segment.at))
                    .font(Destina.ui(10).monospacedDigit())
                    .foregroundStyle(Destina.textMuted)
            }
            Text(segment.text)
                .font(Destina.ui(12))
                .lineSpacing(3)
                .foregroundStyle(Destina.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func time(_ milliseconds: Double) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1000)
        return date.formatted(date: .omitted, time: .shortened)
    }

    /// The expanded panel. Speaker relabeling, prepared prompts and clearing
    /// live here rather than in the always-visible rail.
    private var controls: some View {
        VStack(alignment: .leading, spacing: 14) {
            Rectangle().fill(Destina.line).frame(height: 1)
            if !client.speakerLabels.isEmpty {
                Eyebrow("Who is speaking?")
                ForEach(client.speakerLabels, id: \.self) { label in
                    HStack(spacing: 12) {
                        Text(label)
                            .font(Destina.ui(11).monospacedDigit())
                            .foregroundStyle(Destina.textMuted)
                            .frame(width: 170, alignment: .leading)
                        Picker(label, selection: binding(for: label)) {
                            Text("Unknown voice").tag("")
                            ForEach(feed?.players ?? []) { player in
                                Text(player.name).tag(player.id)
                            }
                        }
                        .labelsHidden()
                        .tint(Destina.tan)
                    }
                }
            }
            if !client.speakers.isEmpty {
                Eyebrow("Who has been talking")
                ForEach(client.speakers) { activity in
                    HStack {
                        Text(activity.speakerLabel)
                            .font(Destina.ui(11).monospacedDigit())
                            .foregroundStyle(Destina.textMuted)
                        Spacer()
                        Text("\(activity.words) words")
                            .font(Destina.ui(11).monospacedDigit())
                            .foregroundStyle(Destina.text)
                    }
                }
                Text("Counted per minute in TigerDB over the last twenty minutes.")
                    .font(Destina.ui(10))
                    .foregroundStyle(Destina.textMuted)
            }
            if let summary = conversation?.summary, !summary.isEmpty {
                Eyebrow("Conversation so far")
                Text(summary)
                    .font(Destina.ui(12))
                    .foregroundStyle(Destina.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Toggle(
                "Prepare conversation prompts after each turn",
                isOn: Binding(
                    get: { conversation?.automatic ?? false },
                    set: { value in Task { await client.setAutomaticPrompts(value) } }
                )
            )
            .font(Destina.ui(12))
            .tint(Destina.tan)
            Text("Leaving this off keeps Muse spending under manual control.")
                .font(Destina.ui(10))
                .foregroundStyle(Destina.textMuted)
            HStack(spacing: 12) {
                if store.confirming == .clearTranscript {
                    Text("Clear the transcript, summary and voice names?")
                        .font(Destina.ui(11))
                        .foregroundStyle(Destina.tanHover)
                    Button("Clear it") {
                        store.confirming = nil
                        Task { await client.conversationAction("clear") }
                    }
                    .buttonStyle(.destinaDestructive)
                    Button("Keep it") { store.confirming = nil }
                        .buttonStyle(SecondaryButtonStyle())
                } else {
                    Button("Clear transcript") { store.confirming = .clearTranscript }
                        .buttonStyle(SecondaryButtonStyle())
                    if conversation?.status == "live" {
                        Button("Pause listening") {
                            Task { await client.conversationAction("pause") }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
            if let notice = conversation?.notice {
                Text(notice)
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.tanHover)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("Destina stores final transcript text, not audio. Recording still needs everyone's agreement.")
                .font(Destina.ui(10))
                .foregroundStyle(Destina.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func binding(for label: String) -> Binding<String> {
        Binding(
            get: {
                segments.first { $0.speakerLabel == label && $0.speakerId != nil }?.speakerId
                    ?? conversation?.segments.first { $0.speakerLabel == label }?.speakerId
                    ?? ""
            },
            set: { value in
                Task { await client.mapSpeaker(label: label, playerID: value.isEmpty ? nil : value) }
            }
        )
    }
}
