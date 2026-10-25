import Foundation
import Observation

/// Game Master client for the Destina server. Calls the same operations the
/// browser at `/gm` calls, over the bearer `/api/control/rooms/:code/*` routes.
///
/// Follows the relay client's conventions: a `runID` generation token so a
/// stale response cannot mutate state, a `blockReason` string that names the
/// first unmet precondition in plain words, and logs that never contain the
/// URL, the room, the credential or a raw server body.
@MainActor @Observable
final class DestinaClient {
    private(set) var feed: GameMasterFeed?
    private(set) var transcript: [TranscriptSegment] = []
    private(set) var speakers: [SpeakerActivity] = []
    /// "tigerdb" or "session", so the interface can say where transcript came from.
    private(set) var transcriptSource = "session"
    private(set) var isLoaded = false
    private(set) var isRefreshing = false
    /// Set by a 403 or 503: the build's credential is wrong or the server has
    /// none. Polling stops, because retrying cannot fix either.
    private(set) var configurationError: String?
    private(set) var lastError: String?
    private(set) var lastUpdated: Date?
    private(set) var busy: Set<String> = []
    let isConfigured: Bool

    @ObservationIgnored private let configuration: DestinaConfiguration?
    @ObservationIgnored private let networking: URLSession
    @ObservationIgnored private var poller: Task<Void, Never>?
    @ObservationIgnored private var runID = UUID()
    /// Prevents overlapping polls, matching the browser's `fetching` guard.
    @ObservationIgnored private var fetching = false
    @ObservationIgnored private var lastSegmentAt: Double?
    @ObservationIgnored private let decoder = JSONDecoder()
    @ObservationIgnored private let encoder = JSONEncoder()

    static let pollInterval: Duration = .seconds(4)

    init(configuration: DestinaConfiguration? = DestinaConfiguration.bundled()) {
        self.configuration = configuration
        isConfigured = configuration != nil
        let settings = URLSessionConfiguration.ephemeral
        settings.urlCache = nil
        settings.httpCookieStorage = nil
        settings.httpShouldSetCookies = false
        settings.timeoutIntervalForRequest = 20
        networking = URLSession(configuration: settings)
    }

    var room: String { configuration?.room ?? "" }
    var promptURL: URL? { configuration?.promptURL }

    /// The first reason the Game Master feed is unusable, or nil when it is ready.
    var blockReason: String? {
        if !isConfigured {
            return "Add DESTINA_URL, DESTINA_ROOM and GM_API_KEY to apple-vision/.env, then rebuild."
        }
        if let configurationError { return configurationError }
        if feed == nil { return lastError ?? "Opening your room…" }
        return nil
    }

    // MARK: - Polling

    func start() {
        guard isConfigured, configurationError == nil, poller == nil else { return }
        let id = runID
        poller = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.runID == id else { return }
                await self.refresh()
                do { try await Task.sleep(for: Self.pollInterval) } catch { return }
            }
        }
    }

    /// Stopping cancels the loop but keeps the last feed, so returning to the
    /// immersive space shows the previous state while the first poll lands.
    func stop() {
        poller?.cancel()
        poller = nil
    }

    func refresh() async {
        guard isConfigured, configurationError == nil, !fetching else { return }
        fetching = true
        isRefreshing = true
        defer { fetching = false; isRefreshing = false }
        let id = runID
        do {
            let next: GameMasterFeed = try await send("questions")
            guard runID == id else { return }
            apply(next)
            await refreshTranscript()
        } catch let error as DestinaError {
            guard runID == id else { return }
            record(error)
        } catch {
            guard runID == id else { return }
            lastError = "Could not reach your room. Check the server and the network."
        }
    }

    /// Only accept a feed at least as new as the one on screen. Without this a
    /// slow poll started before a mutation can overwrite its result.
    private func apply(_ next: GameMasterFeed) {
        if let current = feed, next.room.id == current.room.id,
           next.room.version < current.room.version { return }
        feed = next
        isLoaded = true
        lastError = nil
        lastUpdated = Date()
    }

    private func record(_ error: DestinaError) {
        if error.isConfiguration {
            configurationError = error.message
            stop()
        }
        lastError = error.message
    }

    /// Pages forward from the newest segment already held, so a long session
    /// does not refetch the whole transcript every four seconds.
    private func refreshTranscript() async {
        let id = runID
        var query: [URLQueryItem] = [URLQueryItem(name: "limit", value: "200")]
        if let lastSegmentAt {
            query.append(URLQueryItem(name: "since", value: String(Int(lastSegmentAt))))
        }
        guard let page: TranscriptPage = try? await send("transcript", query: query),
              runID == id else { return }
        transcriptSource = page.source
        speakers = page.speakers.isEmpty ? speakers : page.speakers
        guard !page.segments.isEmpty else { return }
        var known = Set(transcript.map(\.id))
        for segment in page.segments where !known.contains(segment.id) {
            known.insert(segment.id)
            transcript.append(segment)
        }
        transcript = Array(transcript.suffix(400))
        lastSegmentAt = transcript.last?.at
    }

    /// Speaker names are confirmed in SQLite, not in the time-series store, so
    /// they are resolved from the feed rather than from the transcript rows.
    func speakerName(for segment: TranscriptSegment) -> String? {
        if let id = segment.speakerId, let name = feed?.name(for: id) { return name }
        guard let label = segment.speakerLabel else { return nil }
        if let match = feed?.conversation.segments.first(where: { $0.speakerLabel == label && $0.speakerId != nil }) {
            return feed?.name(for: match.speakerId)
        }
        return nil
    }

    /// Every distinct diarization label seen, for the "who is speaking" pickers.
    var speakerLabels: [String] {
        var seen: [String] = []
        for segment in transcript + (feed?.conversation.segments ?? []) {
            if let label = segment.speakerLabel, !seen.contains(label) { seen.append(label) }
        }
        return seen
    }

    // MARK: - Mutations

    /// Mutate, then refresh immediately. The server's snapshot is authoritative,
    /// so nothing here guesses at the resulting state.
    @discardableResult
    private func act(_ name: String, _ path: String, _ body: [String: Any]) async -> Bool {
        guard isConfigured, configurationError == nil, !busy.contains(name) else { return false }
        busy.insert(name)
        defer { busy.remove(name) }
        let id = runID
        do {
            let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
            let _: EmptyResponse = try await send(path, method: "POST", body: data)
            guard runID == id else { return false }
            lastError = nil
            await refresh()
            return true
        } catch let error as DestinaError {
            guard runID == id else { return false }
            record(error)
            return false
        } catch {
            guard runID == id else { return false }
            lastError = "That change did not reach your room. Try again."
            return false
        }
    }

    func isBusy(_ name: String) -> Bool { busy.contains(name) }

    @discardableResult
    func generate(origin: String, targetPlayerID: String?, context: String) async -> Bool {
        var body: [String: Any] = ["origin": origin, "context": context, "replace": true]
        if let targetPlayerID, !targetPlayerID.isEmpty { body["targetPlayerId"] = targetPlayerID }
        return await act("generate", "recommendations", body)
    }

    /// `instructions` carries edited wording. The server requires at least 15
    /// characters, so an unchanged or near-empty edit is not sent.
    @discardableResult
    func assign(recommendationID: String, instructions: String? = nil) async -> Bool {
        var body: [String: Any] = ["recommendationId": recommendationID]
        if let instructions, instructions.trimmingCharacters(in: .whitespacesAndNewlines).count >= 15 {
            body["instructions"] = instructions
        }
        return await act("assign", "assign", body)
    }

    @discardableResult
    func clear(status: String) async -> Bool {
        await act("clear", "clear", ["status": status])
    }

    @discardableResult
    func mapSpeaker(label: String, playerID: String?, dismissRoundID: String? = nil) async -> Bool {
        var body: [String: Any] = ["speakerLabel": label, "playerId": playerID ?? NSNull()]
        if let dismissRoundID { body["dismissRoundId"] = dismissRoundID }
        return await act("speaker", "speaker", body)
    }

    @discardableResult
    func setAutomaticPrompts(_ automatic: Bool) async -> Bool {
        await act("conversation", "conversation", ["automatic": automatic])
    }

    @discardableResult
    func conversationAction(_ action: String) async -> Bool {
        let changed = await act("conversation", "conversation", ["action": action])
        if changed, action == "clear" {
            transcript = []
            lastSegmentAt = nil
            speakers = []
        }
        return changed
    }

    /// Consent is the server's own precondition, so it is passed explicitly
    /// rather than assumed. `linear16` matches what the headset can encode
    /// without pulling in a container format.
    func audioTicket() async -> AudioTicket? {
        guard isConfigured, configurationError == nil, !busy.contains("audio") else { return nil }
        // A ticket is one-use and expires in 60 seconds, so a double press
        // must not quietly burn one.
        busy.insert("audio")
        defer { busy.remove("audio") }
        do {
            let body = try JSONSerialization.data(
                withJSONObject: ["consent": true, "format": "linear16"], options: [.sortedKeys])
            let ticket: AudioTicket = try await send("audio-ticket", method: "POST", body: body)
            lastError = nil
            return ticket
        } catch let error as DestinaError {
            record(error)
            return nil
        } catch {
            lastError = "Could not prepare a listening connection."
            return nil
        }
    }

    /// Where the audio socket lives, for the capture layer to build its URL.
    var serverBase: URL? { configuration?.base }

    @discardableResult
    func approveRewards(roundID: String, awards: [RewardAward]) async -> Bool {
        let payload = awards.map { award in
            [
                "playerId": award.playerId,
                "criteria": award.criteria,
                "evidenceIds": Array(award.evidenceIds.prefix(RewardCriterion.maximumEvidence)),
                "note": String(award.note.prefix(RewardCriterion.maximumNote))
            ] as [String: Any]
        }
        return await act("rewards", "rewards/approve", ["roundId": roundID, "awards": payload])
    }

    @discardableResult
    func rewardSettings(_ settings: [String: Any]) async -> Bool {
        await act("rewardSettings", "rewards/settings", settings)
    }

    @discardableResult
    func settle(roundID: String) async -> Bool {
        await act("settle", "rewards/settle", ["roundId": roundID])
    }

    @discardableResult
    func finish() async -> Bool {
        await act("finish", "finish", [:])
    }

    @discardableResult
    func reset() async -> Bool {
        let changed = await act("reset", "reset", ["confirm": true])
        if changed { transcript = []; lastSegmentAt = nil; speakers = [] }
        return changed
    }

    // MARK: - Transport

    private struct EmptyResponse: Decodable {
        init(from decoder: Decoder) throws {}
        init() {}
    }

    private func send<T: Decodable>(_ path: String, method: String = "GET",
                                    body: Data? = nil, query: [URLQueryItem] = []) async throws -> T {
        guard let configuration,
              let request = configuration.request(path, method: method, body: body, query: query) else {
            throw DestinaError(status: 0, message: "The Destina server address is not valid.")
        }
        let (data, response) = try await networking.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let error = DestinaError.decode(data, status: status)
            print("[destina] request failed status=\(status)")
            throw error
        }
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            print("[destina] could not decode \(T.self)")
            throw DestinaError(
                status: status,
                message: "The server sent something this app could not read. Check that both sides are up to date."
            )
        }
    }
}
