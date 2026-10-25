import Foundation

/// Connection details for the Destina game server, read from the same generated
/// `RelayConfig.plist` the relay uses. `Scripts/build_relay_config.py` copies
/// `DESTINA_URL`, `DESTINA_ROOM` and `GM_API_KEY` out of `apple-vision/.env`.
///
/// The key is a global Game Master credential, not a room-scoped one. A build
/// that carries it can change any room on that server, so a built app is a
/// credential-bearing artifact. Never log the URL, the room or the key.
struct DestinaConfiguration {
    let base: URL
    let room: String
    let key: String

    static func bundled() -> DestinaConfiguration? {
        guard let path = Bundle.main.url(forResource: "RelayConfig", withExtension: "plist"),
              let data = try? Data(contentsOf: path),
              let values = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String],
              let rawURL = values["destinaURL"], let base = URL(string: rawURL),
              base.scheme == "https" || base.scheme == "http",
              let room = values["destinaRoom"], !room.isEmpty,
              let key = values["destinaKey"], !key.isEmpty else { return nil }
        return DestinaConfiguration(base: base, room: room.uppercased(), key: key)
    }

    /// Bearer control routes only. The cookie flow at `/api/questions/*` is for
    /// browsers; a native client has no use for it.
    func request(_ path: String, method: String = "GET", body: Data? = nil,
                 query: [URLQueryItem] = []) -> URLRequest? {
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/api/control/rooms/\(room)/\(path)"
            .replacingOccurrences(of: "//", with: "/")
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.timeoutInterval = 20
        return request
    }

    /// The player-facing page for a prompt, shown as a preview on the headset.
    var promptURL: URL { base.appendingPathComponent("prompt") }

    /// The audio bridge, on the same origin as the API. The ticket names the
    /// path, so an older server that moves it keeps working.
    static func audioURL(base: URL, path: String) -> URL? {
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false),
              let scheme = components.scheme else { return nil }
        components.scheme = scheme == "http" ? "ws" : "wss"
        components.path = path.hasPrefix("/") ? path : "/" + path
        components.query = nil
        return components.url
    }
}
