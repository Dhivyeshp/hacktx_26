import Foundation

/// Decodable mirrors of `shared/types.ts` and `shared/rewards.ts`.
/// Field names and optionality match the server exactly; when the server adds a
/// field this file is the one place that has to learn about it.
///
/// Timestamps arrive as milliseconds since the epoch, as `Date.now()` produces
/// them, so they stay as `Double` rather than becoming `Date` at the boundary.

enum CapsuleType: String, Codable, CaseIterable, Sendable {
    case duel = "Duel"
    case bounty = "Bounty"
    case hotSeat = "Hot Seat"
    case jinx = "Jinx"
    case forge = "Forge"
    case golden = "Golden"
}

struct Recommendation: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let type: CapsuleType
    let title: String
    let instructions: String
    var secret: String?
    let participants: [String]
    let duration: Int
    let reason: String
    var sourceInterestIds: [String] = []
    /// `live` came from Muse, `fallback` from the free question library.
    let mode: String
    var score: Double = 0
    var transcriptIds: [String]?

    /// The server treats the first participant as the target: the person whose
    /// phone shows a private mission. Delivery follows the same rule.
    var targetPlayerID: String? { participants.first }
    var isFromLibrary: Bool { mode == "fallback" }
}

struct Round: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let number: Int
    let recommendation: Recommendation
    /// "assigned", "completed" or "passed".
    let status: String
    var assignedAt: Double?
    var endedAt: Double?
}

struct RoomInfo: Codable, Equatable, Sendable {
    let id: String
    let code: String
    let name: String
    let version: Int
    /// "lobby", "active" or "finished".
    let status: String
    let playerCount: Int
    let readyCount: Int
}

struct FeedPlayer: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let ready: Bool
    let participation: Int

    var initial: String { String(name.prefix(1)).uppercased() }
}

struct SuggestionBatch: Codable, Identifiable, Equatable, Sendable {
    let id: String
    var createdAt: Double?
    /// "profiles" or "conversation".
    let origin: String
    let recommendations: [Recommendation]
}

struct TranscriptSegment: Codable, Identifiable, Equatable, Sendable {
    let id: String
    var speakerId: String?
    let text: String
    let at: Double
    var sequence: Int?
    var roundId: String?
    var speakerLabel: String?
    var origin: String?

    var isTestText: Bool { origin == "test" }
}

struct SpeakerHint: Codable, Identifiable, Equatable, Sendable {
    let speakerLabel: String
    let roundId: String
    let playerId: String
    let name: String
    let excerpt: String

    var id: String { "\(speakerLabel):\(roundId)" }
}

struct ConversationFeed: Codable, Equatable, Sendable {
    /// "not_connected", "live" or "paused".
    let status: String
    var segments: [TranscriptSegment] = []
    var summary: String = ""
    var speakerHints: [SpeakerHint] = []
    var automatic: Bool = false
    var transcriptionReady: Bool = false
    var notice: String?
    var requestCount: Int = 0
    var requestLimit: Int = 0
}

/// The full Game Master feed, from `GET /api/control/rooms/:code/questions`.
/// The thinner `ControlSnapshot` on the same server is not enough for this UI.
struct GameMasterFeed: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let room: RoomInfo
    var players: [FeedPlayer] = []
    var batches: [SuggestionBatch] = []
    var activeQuestion: Round?
    var history: [Round] = []
    var preparing: Bool = false
    var canControl: Bool = false
    var availableIds: [String] = []
    var notice: String?
    let conversation: ConversationFeed
    var rewards: RewardsFeed?

    func name(for playerID: String?) -> String? {
        guard let playerID else { return nil }
        return players.first { $0.id == playerID }?.name
    }

    /// Everyone named in a prompt, in the server's order, target first.
    func names(for recommendation: Recommendation) -> String {
        let named = recommendation.participants.compactMap { name(for: $0) }
        return named.isEmpty ? "the table" : named.formatted(.list(type: .and))
    }
}

struct TranscriptPage: Codable, Sendable {
    /// "tigerdb" when the time-series store answered, "session" on fallback.
    let source: String
    var segments: [TranscriptSegment] = []
    var speakers: [SpeakerActivity] = []
}

struct SpeakerActivity: Codable, Identifiable, Equatable, Sendable {
    let speakerLabel: String
    let segments: Int
    let words: Int

    var id: String { speakerLabel }
}

// MARK: - Tina Tokens

/// Mirrors `shared/rewards.ts`. Points and bounds are the server's; a headset
/// that disagreed would let a Game Master approve an award the server rejects.
struct RewardCriterion: Identifiable, Equatable, Sendable {
    let id: String
    let label: String
    let points: Int

    static let all: [RewardCriterion] = [
        RewardCriterion(id: "contribution", label: "Contributed to the prompt", points: 2),
        RewardCriterion(id: "followup", label: "Asked a thoughtful follow-up", points: 3),
        RewardCriterion(id: "building", label: "Built on someone’s idea", points: 2),
        RewardCriterion(id: "inclusion", label: "Invited someone into the conversation", points: 2),
        RewardCriterion(id: "creation", label: "Finished something together", points: 1)
    ]
    static let maximumPerPlayer = 10
    static let maximumEvidence = 6
    static let maximumNote = 240

    static func points(for criteria: [String]) -> Int {
        min(maximumPerPlayer, all.filter { criteria.contains($0.id) }.reduce(0) { $0 + $1.points })
    }
}

struct RewardAward: Codable, Equatable, Sendable {
    let playerId: String
    var criteria: [String] = []
    var evidenceIds: [String] = []
    var note: String = ""
    var points: Int = 0
    var confirmed: Bool = false
    var signature: String?
}

struct RewardSuggestion: Codable, Identifiable, Equatable, Sendable {
    let roundId: String
    let playerId: String
    let criterion: String
    var evidenceIds: [String] = []
    let reason: String

    var id: String { "\(roundId):\(playerId):\(criterion)" }
}

struct RewardPlayerStats: Codable, Identifiable, Equatable, Sendable {
    let playerId: String
    var approved: Int = 0
    var confirmed: Int = 0
    var pending: Int = 0
    var level: Int = 0
    var completed: Int = 0
    var passed: Int = 0
    var connections: Int = 0
    var confirmedSpeechSegments: Int = 0
    var breakdown: [String: Int] = [:]
    var wallet: String?

    var id: String { playerId }
}

struct RewardRoundSummary: Codable, Identifiable, Equatable, Sendable {
    let roundId: String
    let number: Int
    let title: String
    /// "completed" or "passed".
    let status: String
    var awards: [RewardAward] = []
    /// "unreviewed", "approved", "processing", "failed" or "confirmed".
    var settlement: String = "unreviewed"
    var error: String?

    var id: String { roundId }
    var isReviewed: Bool { settlement != "unreviewed" }
    var isSettling: Bool { settlement == "processing" }
}

struct RewardsFeed: Codable, Equatable, Sendable {
    var currency: String = "Tina Tokens"
    var network: String = "devnet"
    var configured: Bool = false
    var gameId: String = ""
    var goal: Int = 0
    var paused: Bool = false
    var celebrated: Bool = false
    var approved: Int = 0
    var confirmed: Int = 0
    var players: [RewardPlayerStats] = []
    var rounds: [RewardRoundSummary] = []
    var suggestions: [RewardSuggestion] = []

    /// The goal stops being editable once any round has left review, so the
    /// target cannot move after people have been scored against it.
    var goalLocked: Bool { rounds.contains { $0.isReviewed } }

    func suggestions(roundId: String, playerId: String) -> [RewardSuggestion] {
        suggestions.filter { $0.roundId == roundId && $0.playerId == playerId }
    }
}

// MARK: - Errors

/// The server's `{ "error": "..." }` envelope. Its messages are written for a
/// person to read, so they are shown as-is rather than being reworded here.
struct DestinaError: LocalizedError, Equatable {
    let status: Int
    let message: String
    var errorDescription: String? { message }

    /// 403 and 503 mean the build's credential is wrong or the server has none.
    /// Retrying cannot fix either, so the client stops instead of polling on.
    var isConfiguration: Bool { status == 403 || status == 503 }

    static func decode(_ data: Data, status: Int) -> DestinaError {
        struct Envelope: Decodable { let error: String? }
        let decoded = try? JSONDecoder().decode(Envelope.self, from: data)
        return DestinaError(
            status: status,
            message: decoded?.error ?? "Could not reach your room. Check the server and try again."
        )
    }
}
