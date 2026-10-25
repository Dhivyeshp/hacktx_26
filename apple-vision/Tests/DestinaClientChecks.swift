import Foundation

/// Decoding and the guards that keep a polling client honest. Run with:
///
///   xcrun swiftc -parse-as-library Centerpiece/DestinaModels.swift \
///     Centerpiece/DestinaConfig.swift Tests/DestinaClientChecks.swift \
///     -o /tmp/centerpiece-destina-checks && /tmp/centerpiece-destina-checks
@main
struct DestinaClientChecks {
    static let feedJSON = """
    {
      "schemaVersion": 1,
      "room": {"id":"ABC123","code":"ABC123","name":"Tuesday table","version":7,
               "status":"active","playerCount":3,"readyCount":3},
      "players": [
        {"id":"p1","name":"Maya","ready":true,"participation":2},
        {"id":"p2","name":"Jordan","ready":true,"participation":1},
        {"id":"p3","name":"Alex","ready":false,"participation":0}
      ],
      "batches": [
        {"id":"b1","createdAt":1792919421361,"origin":"profiles","recommendations":[
          {"id":"r1","type":"Bounty","title":"The quiet trade","instructions":"Swap one small recommendation.",
           "secret":"Maya, ask without saying why.","participants":["p1","p2"],"duration":60,
           "reason":"Both saved an interest in books.","sourceInterestIds":["i1","i2"],
           "mode":"live","score":112}
        ]}
      ],
      "activeQuestion": null,
      "history": [],
      "preparing": false,
      "canControl": true,
      "availableIds": ["r1"],
      "conversation": {"status":"paused","segments":[
          {"id":"s1","text":"Where would we go?","at":1792919421361,"sequence":1,
           "speakerLabel":"abc-speaker-1","origin":"microphone"}
        ],
        "summary":"","speakerHints":[],"automatic":false,"transcriptionReady":true,
        "requestCount":3,"requestLimit":12}
    }
    """

    static func main() throws {
        let decoder = JSONDecoder()
        let feed = try decoder.decode(GameMasterFeed.self, from: Data(feedJSON.utf8))

        // The server's shapes decode without loss.
        precondition(feed.room.version == 7)
        precondition(feed.players.count == 3)
        precondition(feed.players[2].ready == false)
        precondition(feed.name(for: "p2") == "Jordan")

        let recommendation = feed.batches[0].recommendations[0]
        precondition(recommendation.type == .bounty)
        precondition(recommendation.secret != nil)
        precondition(recommendation.targetPlayerID == "p1", "the target is the first participant")
        precondition(recommendation.isFromLibrary == false)
        precondition(feed.names(for: recommendation) == "Maya and Jordan")
        precondition(feed.conversation.requestLimit == 12)
        precondition(feed.conversation.segments[0].isTestText == false)
        // Optional server fields stay optional rather than failing the decode.
        precondition(feed.rewards == nil && feed.notice == nil && feed.activeQuestion == nil)

        // A feed that is behind the one on screen must not be applied, or a
        // slow poll started before a mutation overwrites its result.
        precondition(!shouldApply(next: 6, current: 7, sameRoom: true))
        precondition(shouldApply(next: 7, current: 7, sameRoom: true))
        precondition(shouldApply(next: 8, current: 7, sameRoom: true))
        // A different room always replaces, because versions are per room.
        precondition(shouldApply(next: 1, current: 9, sameRoom: false))

        // The error envelope becomes a message a person can read, and the two
        // credential failures are marked so the client stops instead of looping.
        let denied = DestinaError.decode(Data(#"{"error":"Game Master authorization required."}"#.utf8), status: 403)
        precondition(denied.message == "Game Master authorization required.")
        precondition(denied.isConfiguration)
        precondition(DestinaError.decode(Data(), status: 503).isConfiguration)
        precondition(!DestinaError.decode(Data(), status: 409).isConfiguration)
        precondition(!DestinaError.decode(Data("not json".utf8), status: 500).message.isEmpty)

        // Award points are capped per player, matching the server's bound.
        precondition(RewardCriterion.points(for: ["contribution", "followup"]) == 5)
        precondition(RewardCriterion.points(for: RewardCriterion.all.map(\.id)) == 10)
        precondition(RewardCriterion.points(for: ["unknown"]) == 0)

        // Transcript pages name their own source so the interface can say which.
        let page = try decoder.decode(
            TranscriptPage.self,
            from: Data(#"{"source":"tigerdb","segments":[],"speakers":[{"speakerLabel":"a","segments":2,"words":30}]}"#.utf8)
        )
        precondition(page.source == "tigerdb" && page.speakers[0].words == 30)

        // Requests carry the bearer credential and never put it in the URL.
        let configuration = DestinaConfiguration(
            base: URL(string: "https://destina.example")!, room: "ABC123", key: "fixture-key"
        )
        let request = configuration.request("assign", method: "POST", body: Data("{}".utf8))!
        precondition(request.url?.path == "/api/control/rooms/ABC123/assign")
        precondition(request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-key")
        precondition(!(request.url?.absoluteString.contains("fixture-key") ?? true))
        let paged = configuration.request("transcript", query: [URLQueryItem(name: "since", value: "10")])!
        precondition(paged.url?.query == "since=10")

        // The audio socket must ride the same origin, upgraded, and must not
        // inherit a query string from the base URL.
        precondition(DestinaConfiguration.audioURL(
            base: URL(string: "https://destina.example")!, path: "/api/audio")?.absoluteString
            == "wss://destina.example/api/audio")
        precondition(DestinaConfiguration.audioURL(
            base: URL(string: "http://localhost:3000")!, path: "/api/audio")?.absoluteString
            == "ws://localhost:3000/api/audio")
        precondition(DestinaConfiguration.audioURL(
            base: URL(string: "https://destina.example")!, path: "api/audio")?.absoluteString
            == "wss://destina.example/api/audio")

        let ticket = try decoder.decode(
            AudioTicket.self,
            from: Data(#"{"token":"abc","expiresAt":1792919421361,"path":"/api/audio"}"#.utf8))
        precondition(ticket.path == "/api/audio" && ticket.token == "abc")

        print("Destina client checks passed")
    }

    /// Mirrors `DestinaClient.apply`, so the rule can be checked without a server.
    static func shouldApply(next: Int, current: Int, sameRoom: Bool) -> Bool {
        sameRoom ? next >= current : true
    }
}
