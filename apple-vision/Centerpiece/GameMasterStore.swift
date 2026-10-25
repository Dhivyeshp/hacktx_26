import Foundation
import Observation

/// Which panel the stage shows. The server owns whether a prompt is assigned;
/// this only decides what the Game Master is looking at while that is true.
enum GameMasterStage: Equatable {
    /// Not enough people have joined and saved interests yet.
    case waiting
    /// Choosing the next prompt.
    case choosing
    /// A prompt is assigned and on the players' phones. Driving is unlocked.
    case driving
    /// The capsule has been delivered. Record the outcome.
    case reviewing
}

/// View state for the Game Master panels: the stage, the pending workbench
/// input and the two-step confirmations. Everything authoritative lives in
/// `DestinaClient.feed`; nothing here is a second copy of server state.
@MainActor @Observable
final class GameMasterStore {
    // Workbench input
    var targetPlayerID: String = ""
    var context: String = ""
    var editingRecommendation: Recommendation?
    var editedInstructions: String = ""

    // Panels and confirmations
    var openPanel: Panel?
    var confirming: Confirmation?
    var selectedRewardRoundID: String?
    var draftAwards: [String: RewardAward] = [:]
    var goalDraft: String = ""
    var pastedSpeaker: String = ""
    var pastedText: String = ""

    /// Set once the capsule for the current round has been delivered, so the
    /// stage moves on to recording an outcome. Cleared when the round changes.
    private(set) var deliveredRoundID: String?

    enum Panel: String, Identifiable {
        case connection, tokens, session, promptPreview, conversation
        var id: String { rawValue }
    }
    enum Confirmation: String, Identifiable {
        case reset, finish, clearTranscript, settle
        var id: String { rawValue }
    }

    func stage(for feed: GameMasterFeed?) -> GameMasterStage {
        guard let feed else { return .waiting }
        if let active = feed.activeQuestion {
            return deliveredRoundID == active.id ? .reviewing : .driving
        }
        return feed.room.readyCount >= 2 ? .choosing : .waiting
    }

    func noteDelivered(_ round: Round?) {
        deliveredRoundID = round?.id
    }

    /// Called whenever the assigned round changes so a delivery recorded for an
    /// earlier prompt cannot keep the next one out of driving.
    func roundChanged(to round: Round?) {
        if deliveredRoundID != round?.id { deliveredRoundID = nil }
        editingRecommendation = nil
    }

    // MARK: - Generation gates
    //
    // Ported from the browser workbench. These are the server's rules; a
    // headset that guessed differently would offer a button that 409s.

    func generationBlockReason(feed: GameMasterFeed?, minimumPlayers: Int) -> String? {
        guard let feed else { return "Waiting for your room." }
        if !feed.canControl { return "This view cannot change the room." }
        if feed.activeQuestion != nil { return "Clear the prompt on the table first." }
        if feed.preparing { return "Prompts are being prepared." }
        if feed.room.playerCount < minimumPlayers {
            return "At least \(minimumPlayers) people need to join."
        }
        if feed.room.readyCount < feed.room.playerCount {
            return "Everyone needs at least one saved interest."
        }
        if feed.conversation.requestCount >= feed.conversation.requestLimit {
            return "This game's Muse allowance is used up. The question library is still free."
        }
        return nil
    }

    /// The library costs no Muse request, so it stays available after the paid
    /// allowance runs out.
    func libraryBlockReason(feed: GameMasterFeed?, minimumPlayers: Int) -> String? {
        guard let feed else { return "Waiting for your room." }
        if !feed.canControl { return "This view cannot change the room." }
        if feed.activeQuestion != nil { return "Clear the prompt on the table first." }
        if feed.preparing { return "Prompts are being prepared." }
        if feed.room.playerCount < minimumPlayers {
            return "At least \(minimumPlayers) people need to join."
        }
        if feed.room.readyCount < feed.room.playerCount {
            return "Everyone needs at least one saved interest."
        }
        return nil
    }

    /// Conversation prompts need enough new speech for the server to accept them.
    func conversationBlockReason(feed: GameMasterFeed?, minimumPlayers: Int) -> String? {
        if let reason = generationBlockReason(feed: feed, minimumPlayers: minimumPlayers) { return reason }
        guard let feed, !feed.conversation.segments.isEmpty else {
            return "No conversation has been recorded yet."
        }
        return nil
    }

    /// A card can be acted on only while it is still in the live queue. Older
    /// batches stay visible as history.
    func canUse(_ recommendation: Recommendation, feed: GameMasterFeed?) -> Bool {
        guard let feed else { return false }
        return feed.canControl
            && feed.availableIds.contains(recommendation.id)
            && feed.activeQuestion == nil
    }

    // MARK: - Reward drafting

    func beginAwards(round: RewardRoundSummary, players: [FeedPlayer]) {
        selectedRewardRoundID = round.roundId
        draftAwards = [:]
        for player in players {
            let existing = round.awards.first { $0.playerId == player.id }
            draftAwards[player.id] = existing ?? RewardAward(playerId: player.id)
        }
    }

    func toggleCriterion(_ criterion: RewardCriterion, for playerID: String) {
        guard var award = draftAwards[playerID] else { return }
        if let index = award.criteria.firstIndex(of: criterion.id) {
            award.criteria.remove(at: index)
        } else {
            award.criteria.append(criterion.id)
        }
        draftAwards[playerID] = award
    }

    func applySuggestions(_ suggestions: [RewardSuggestion], for playerID: String) {
        guard var award = draftAwards[playerID] else { return }
        for suggestion in suggestions where !award.criteria.contains(suggestion.criterion) {
            award.criteria.append(suggestion.criterion)
        }
        let evidence = suggestions.flatMap(\.evidenceIds)
        for id in evidence where !award.evidenceIds.contains(id) {
            award.evidenceIds.append(id)
        }
        award.evidenceIds = Array(award.evidenceIds.prefix(RewardCriterion.maximumEvidence))
        draftAwards[playerID] = award
    }

    var draftTotal: Int {
        draftAwards.values.reduce(0) { $0 + RewardCriterion.points(for: $1.criteria) }
    }

    /// The server reviews every current player exactly once, so an unscored
    /// person is sent as an empty award rather than left out.
    func awards(for players: [FeedPlayer]) -> [RewardAward] {
        players.map { draftAwards[$0.id] ?? RewardAward(playerId: $0.id) }
    }

    /// The server's own rules, so the button does not offer a request it will
    /// reject. Only "Contributed to the prompt" stands on its own; every other
    /// criterion needs a written observation or confirmed transcript evidence.
    func approvalBlockReason(round: RewardRoundSummary?, players: [FeedPlayer]) -> String? {
        guard let round else { return "Choose a round to review." }
        if round.isReviewed { return "This round has already been reviewed." }
        if players.isEmpty { return "No players to review." }
        for player in players {
            let award = draftAwards[player.id] ?? RewardAward(playerId: player.id)
            if round.status == "passed" && !award.criteria.isEmpty {
                return "Passed rounds carry no awards."
            }
            let needsEvidence = award.criteria.contains { $0 != "contribution" }
            if needsEvidence && award.note.trimmingCharacters(in: .whitespaces).isEmpty
                && award.evidenceIds.isEmpty {
                return "Add a short note for \(player.name) before awarding a bonus."
            }
        }
        return nil
    }
}
