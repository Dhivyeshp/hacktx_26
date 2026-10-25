import SwiftUI

/// "The next prompt". Spotlight, optional context, and the three ways to get
/// options. Muse generation is bounded by a real spending allowance, so the
/// free question library is presented as its own distinct choice.
struct PromptWorkbenchView: View {
    @Bindable var client: DestinaClient
    @Bindable var store: GameMasterStore
    var onAssigned: (Round) -> Void

    private var feed: GameMasterFeed? { client.feed }
    private var conversation: ConversationFeed? { feed?.conversation }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            if let notice = feed?.notice {
                Text(notice)
                    .font(Destina.ui(12))
                    .foregroundStyle(Destina.tanHover)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Controls beside the cards rather than above them. Stacked, the
            // panel grew tall enough to either overlap the camera or push the
            // cards' own buttons below a comfortable downward gaze.
            HStack(alignment: .top, spacing: 20) {
                controls.frame(width: 320, alignment: .leading)
                Rectangle().fill(Destina.line).frame(width: 1)
                cards
            }
        }
        .frame(width: 1150, alignment: .leading)
        .destinaPanel(22)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 5) {
                Eyebrow("The next prompt")
                Text("Choose what happens next")
                    .font(Destina.heading(30))
                    .foregroundStyle(Destina.text)
            }
            Spacer()
            if let conversation {
                Text("\(conversation.requestCount)/\(conversation.requestLimit) Muse requests")
                    .font(Destina.ui(11).monospacedDigit())
                    .foregroundStyle(Destina.textMuted)
            }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 7) {
                Eyebrow("Spotlight")
                Picker("Spotlight", selection: $store.targetPlayerID) {
                    Text("Let the game balance turns").tag("")
                    ForEach(feed?.players ?? []) { player in
                        Text(player.name).tag(player.id)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(Destina.tan)
            }
            VStack(alignment: .leading, spacing: 7) {
                Eyebrow("A little context")
                TextField("Anything happening at the table", text: $store.context, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(Destina.ui(14))
                    .lineLimit(1...2)
                    .padding(10)
                    .background(Destina.bgRaised)
                    .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
                    .onChange(of: store.context) { _, value in
                        if value.count > 800 { store.context = String(value.prefix(800)) }
                    }
            }
            VStack(alignment: .leading, spacing: 9) {
                generateButton(
                    "Get three Muse prompts",
                    origin: "profiles",
                    blocked: store.generationBlockReason(feed: feed),
                    primary: true
                )
                generateButton(
                    "From the conversation",
                    origin: "conversation",
                    blocked: store.conversationBlockReason(feed: feed)
                )
                generateButton(
                    "Use the question library",
                    origin: "library",
                    blocked: store.libraryBlockReason(feed: feed)
                )
            }
            if let reason = store.libraryBlockReason(feed: feed) {
                Text(reason)
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.textMuted)
            } else if store.generationBlockReason(feed: feed) != nil {
                Text("The question library stays free when the Muse allowance is used up.")
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.textMuted)
            }
        }
    }

    @ViewBuilder
    private func generateButton(_ title: String, origin: String, blocked: String?,
                                primary: Bool = false) -> some View {
        let action: () -> Void = {
            Task {
                await client.generate(
                    origin: origin,
                    targetPlayerID: store.targetPlayerID.isEmpty ? nil : store.targetPlayerID,
                    context: store.context
                )
            }
        }
        Group {
            if primary {
                Button(title, action: action).buttonStyle(.destinaPrimary)
            } else {
                Button(title, action: action).buttonStyle(.destinaSecondary)
            }
        }
        .disabled(blocked != nil || client.isBusy("generate"))
        .accessibilityHint(blocked ?? "")
    }

    @ViewBuilder
    private var cards: some View {
        if feed?.preparing == true || client.isBusy("generate") {
            HStack(spacing: 12) {
                ProgressView().tint(Destina.tan)
                Text("Preparing three prompts.")
                    .font(Destina.ui(14))
                    .foregroundStyle(Destina.textMuted)
            }
            .frame(maxWidth: .infinity, minHeight: 170)
        } else if let batch = currentBatch, !batch.recommendations.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(batch.origin == "conversation" ? "From the conversation" : "From your people")
                HStack(alignment: .top, spacing: 14) {
                    ForEach(batch.recommendations) { recommendation in
                        PromptCardView(
                            recommendation: recommendation,
                            feed: feed,
                            isUsable: store.canUse(recommendation, feed: feed),
                            isAssigning: client.isBusy("assign"),
                            onUse: { assign(recommendation, instructions: nil) },
                            onEdit: {
                                store.editedInstructions = recommendation.instructions
                                store.editingRecommendation = recommendation
                            }
                        )
                    }
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("No prompts waiting.")
                    .font(Destina.heading(22))
                    .foregroundStyle(Destina.text)
                Text("Generate a set when everyone has saved their interests.")
                    .font(Destina.ui(13))
                    .foregroundStyle(Destina.textMuted)
            }
            .frame(maxWidth: .infinity, minHeight: 170, alignment: .leading)
        }
    }

    /// The newest batch that still has live cards, so an older set does not
    /// take the stage after a fresh generation.
    private var currentBatch: SuggestionBatch? {
        guard let feed else { return nil }
        return feed.batches.last { batch in
            batch.recommendations.contains { feed.availableIds.contains($0.id) }
        } ?? feed.batches.last
    }

    private func assign(_ recommendation: Recommendation, instructions: String?) {
        Task {
            guard await client.assign(recommendationID: recommendation.id, instructions: instructions),
                  let round = client.feed?.activeQuestion else { return }
            store.editingRecommendation = nil
            onAssigned(round)
        }
    }
}

