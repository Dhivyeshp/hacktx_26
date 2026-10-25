import SwiftUI

/// Tina Tokens. Awards are approved per round against fixed criteria, then
/// settled on Solana devnet. Nothing is awarded automatically: voice
/// attribution is a guess, and currency is not paid out on a guess.
struct TokensPanel: View {
    @Bindable var client: DestinaClient
    @Bindable var store: GameMasterStore
    var onClose: () -> Void

    private var feed: GameMasterFeed? { client.feed }
    private var rewards: RewardsFeed? { feed?.rewards }
    private var players: [FeedPlayer] { feed?.players ?? [] }
    private var round: RewardRoundSummary? {
        guard let rewards else { return nil }
        return rewards.rounds.first { $0.roundId == store.selectedRewardRoundID }
            ?? rewards.rounds.last
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            if let rewards {
                summary(rewards)
                Rectangle().fill(Destina.line).frame(height: 1)
                goal(rewards)
                Rectangle().fill(Destina.line).frame(height: 1)
                if rewards.rounds.isEmpty {
                    Text("No completed rounds to score yet.")
                        .font(Destina.ui(13))
                        .foregroundStyle(Destina.textMuted)
                } else {
                    roundPicker(rewards)
                    if let round { awards(round) }
                }
            } else {
                Text("Tina Tokens are not configured on this server.")
                    .font(Destina.ui(13))
                    .foregroundStyle(Destina.textMuted)
            }
            Button("Done", action: onClose)
                .buttonStyle(.destinaPrimary)
        }
        .frame(width: 760, alignment: .leading)
        .destinaPanel(28)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 5) {
            Eyebrow("Tina Tokens")
            Text("What the table earned")
                .font(Destina.heading(32))
                .foregroundStyle(Destina.text)
        }
    }

    private func summary(_ rewards: RewardsFeed) -> some View {
        HStack(spacing: 28) {
            stat("Approved", rewards.approved)
            stat("Confirmed", rewards.confirmed)
            stat("Shared goal", rewards.goal)
            Spacer()
            if !rewards.configured {
                Text("Devnet settlement is not configured. Approving still records the score.")
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.textMuted)
                    .frame(width: 220)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(label)
            Text("\(value)")
                .font(Destina.heading(34).monospacedDigit())
                .foregroundStyle(Destina.text)
        }
    }

    private func goal(_ rewards: RewardsFeed) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Eyebrow("Shared goal")
                Spacer()
                Text("\(rewards.approved) of \(max(rewards.goal, 1))")
                    .font(Destina.ui(12).monospacedDigit())
                    .foregroundStyle(Destina.textMuted)
            }
            ProgressView(
                value: Double(min(rewards.approved, max(rewards.goal, 1))),
                total: Double(max(rewards.goal, 1))
            )
            .tint(Destina.tan)
            if rewards.goalLocked {
                Text("The goal is fixed now that a round has been scored against it.")
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.textMuted)
            } else {
                HStack(spacing: 10) {
                    TextField("Goal", text: $store.goalDraft)
                        .textFieldStyle(.plain)
                        .font(Destina.ui(14).monospacedDigit())
                        .frame(width: 90)
                        .padding(9)
                        .background(Destina.bgRaised)
                        .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
                    Button("Set goal") {
                        guard let value = Int(store.goalDraft), value > 0 else { return }
                        Task { await client.rewardSettings(["goal": value]) }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(Int(store.goalDraft) == nil)
                }
            }
            HStack(spacing: 10) {
                Button(rewards.paused ? "Resume scoring" : "Pause scoring") {
                    Task { await client.rewardSettings(["paused": !rewards.paused]) }
                }
                .buttonStyle(SecondaryButtonStyle())
                if rewards.approved >= rewards.goal && rewards.goal > 0 && !rewards.celebrated {
                    Button("Celebrate the goal") {
                        Task { await client.rewardSettings(["celebrated": true]) }
                    }
                    .buttonStyle(.destinaPrimary)
                }
            }
        }
    }

    private func roundPicker(_ rewards: RewardsFeed) -> some View {
        HStack(spacing: 12) {
            Eyebrow("Round")
            Picker("Round", selection: Binding(
                get: { store.selectedRewardRoundID ?? rewards.rounds.last?.roundId ?? "" },
                set: { id in
                    guard let chosen = rewards.rounds.first(where: { $0.roundId == id }) else { return }
                    store.beginAwards(round: chosen, players: players)
                }
            )) {
                ForEach(rewards.rounds) { entry in
                    Text("\(entry.number). \(entry.title)").tag(entry.roundId)
                }
            }
            .labelsHidden()
            .tint(Destina.tan)
            Spacer()
            if let round {
                Text(round.settlement)
                    .font(Destina.ui(11))
                    .foregroundStyle(round.settlement == "confirmed" ? Destina.sage : Destina.textMuted)
            }
        }
        .onAppear {
            guard store.selectedRewardRoundID == nil, let last = rewards.rounds.last else { return }
            store.beginAwards(round: last, players: players)
        }
    }

    private func awards(_ round: RewardRoundSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(players) { player in playerAwards(player, round: round) }
                }
            }
            .frame(maxHeight: 330)
            if let error = round.error {
                Text(error)
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.tanHover)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let reason = store.approvalBlockReason(round: round, players: players) {
                Text(reason)
                    .font(Destina.ui(11))
                    .foregroundStyle(Destina.tanHover)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 12) {
                Button("Approve \(store.draftTotal) Tina Tokens") {
                    Task {
                        await client.approveRewards(
                            roundID: round.roundId,
                            awards: store.awards(for: players)
                        )
                    }
                }
                .buttonStyle(.destinaPrimary)
                .disabled(
                    store.approvalBlockReason(round: round, players: players) != nil
                        || client.isBusy("rewards")
                )
                if store.confirming == .settle {
                    Text("Settle this round on Solana devnet?")
                        .font(Destina.ui(11))
                        .foregroundStyle(Destina.tanHover)
                    Button("Settle it") {
                        store.confirming = nil
                        Task { await client.settle(roundID: round.roundId) }
                    }
                    .buttonStyle(.destinaDestructive)
                    Button("Not yet") { store.confirming = nil }
                        .buttonStyle(SecondaryButtonStyle())
                } else {
                    Button("Settle on Solana devnet") { store.confirming = .settle }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(round.settlement != "approved" || client.isBusy("settle"))
                }
            }
            Text("At most 10 tokens per person per round. Outcomes stay human-confirmed.")
                .font(Destina.ui(10))
                .foregroundStyle(Destina.textMuted)
        }
    }

    private func playerAwards(_ player: FeedPlayer, round: RewardRoundSummary) -> some View {
        let award = store.draftAwards[player.id] ?? RewardAward(playerId: player.id)
        let suggestions = feed?.rewards?.suggestions(roundId: round.roundId, playerId: player.id) ?? []
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(player.name)
                    .font(Destina.ui(14, weight: .medium))
                    .foregroundStyle(Destina.text)
                Spacer()
                Text("\(RewardCriterion.points(for: award.criteria)) tokens")
                    .font(Destina.ui(12).monospacedDigit())
                    .foregroundStyle(Destina.tan)
            }
            ForEach(RewardCriterion.all) { criterion in
                Button {
                    store.toggleCriterion(criterion, for: player.id)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: award.criteria.contains(criterion.id) ? "checkmark.square.fill" : "square")
                            .foregroundStyle(award.criteria.contains(criterion.id) ? Destina.tan : Destina.textMuted)
                        Text(criterion.label)
                            .font(Destina.ui(12))
                            .foregroundStyle(Destina.text)
                        Spacer()
                        Text("+\(criterion.points)")
                            .font(Destina.ui(11).monospacedDigit())
                            .foregroundStyle(Destina.textMuted)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(award.criteria.contains(criterion.id) ? [.isSelected] : [])
            }
            TextField("What you noticed", text: Binding(
                get: { store.draftAwards[player.id]?.note ?? "" },
                set: { value in
                    store.draftAwards[player.id]?.note = String(value.prefix(RewardCriterion.maximumNote))
                }
            ))
            .textFieldStyle(.plain)
            .font(Destina.ui(12))
            .padding(9)
            .background(Destina.bgRaised)
            .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
            if !suggestions.isEmpty {
                Button("Apply \(suggestions.count) Muse suggestions") {
                    store.applySuggestions(suggestions, for: player.id)
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .destinaInset(14)
    }
}

/// Finishing and resetting. Both are destructive, so both are two-step with
/// the consequence written out rather than implied.
struct SessionPanel: View {
    @Bindable var client: DestinaClient
    @Bindable var store: GameMasterStore
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Eyebrow("This gathering")
            Text("Start again?")
                .font(Destina.heading(32))
                .foregroundStyle(Destina.text)
            Text("Room \(client.room). Updated \(updated).")
                .font(Destina.ui(12))
                .foregroundStyle(Destina.textMuted)
            Rectangle().fill(Destina.line).frame(height: 1)
            finish
            Rectangle().fill(Destina.line).frame(height: 1)
            reset
            Button("Done", action: onClose)
                .buttonStyle(SecondaryButtonStyle())
        }
        .frame(width: 560, alignment: .leading)
        .destinaPanel(28)
    }

    private var updated: String {
        client.lastUpdated?.formatted(date: .omitted, time: .shortened) ?? "not yet"
    }

    @ViewBuilder
    private var finish: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("End the session")
                .font(Destina.ui(15, weight: .medium))
                .foregroundStyle(Destina.text)
            Text("Phones stop showing prompts and the room closes. Conversation and imported profile text are removed. Prompt history stays.")
                .font(Destina.ui(12))
                .foregroundStyle(Destina.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            if store.confirming == .finish {
                HStack(spacing: 12) {
                    Button("End it now") {
                        store.confirming = nil
                        Task { await client.finish() }
                    }
                    .buttonStyle(.destinaDestructive)
                    Button("Keep playing") { store.confirming = nil }
                        .buttonStyle(SecondaryButtonStyle())
                }
            } else {
                Button("End the session") { store.confirming = .finish }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    @ViewBuilder
    private var reset: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Reset the game")
                .font(Destina.ui(15, weight: .medium))
                .foregroundStyle(Destina.text)
            Text("Removes players, interests, imported profiles, transcript, voice names, prompts, rounds and event history. Phones return to onboarding. Spending counters are kept.")
                .font(Destina.ui(12))
                .foregroundStyle(Destina.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            if store.confirming == .reset {
                HStack(spacing: 12) {
                    Button("Reset and remove players") {
                        store.confirming = nil
                        Task { await client.reset() }
                    }
                    .buttonStyle(.destinaDestructive)
                    Button("Cancel") { store.confirming = nil }
                        .buttonStyle(SecondaryButtonStyle())
                }
            } else {
                Button("Reset game") { store.confirming = .reset }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }
}
