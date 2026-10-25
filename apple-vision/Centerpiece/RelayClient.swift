import Foundation
import Observation
import ImageIO

struct RelayConfiguration {
    let url: URL
    let token: String
    let room: String

    static func bundled() -> RelayConfiguration? {
        guard let path = Bundle.main.url(forResource: "RelayConfig", withExtension: "plist"),
              let data = try? Data(contentsOf: path),
              let values = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String],
              let rawURL = values["url"], let url = URL(string: rawURL), url.scheme == "wss",
              let token = values["token"], !token.isEmpty, token != "YOUR_RELAY_TOKEN" else { return nil }
        return RelayConfiguration(url: url, token: token, room: values["room"] ?? "table")
    }

    func request() -> URLRequest {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "role", value: "visionpro"),
                                 URLQueryItem(name: "room", value: room), URLQueryItem(name: "video", value: "1")]
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20
        return request
    }
}

/// Receive-only client for the sibling relay's binary JPEG + JSON protocol.
/// No robot commands are sent. Never log URLs, credentials, or raw server errors.
@MainActor @Observable
final class RelayClient {
    private(set) var latestFrame: CGImage?
    private(set) var peers: [String] = []
    private(set) var isConnected = false
    private(set) var hasFreshFrame = false
    private(set) var status = "Not connected"
    private(set) var framesReceived = 0
    private(set) var rejectedFrames = 0
    let isConfigured: Bool
    @ObservationIgnored private let configuration: RelayConfiguration?
    @ObservationIgnored private let networking: URLSession
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var receiver: Task<Void, Never>?
    @ObservationIgnored private var watchdog: Task<Void, Never>?
    @ObservationIgnored private var lastFrameAt: Date?
    @ObservationIgnored private var connectionStarted = Date()
    @ObservationIgnored private var runID = UUID()

    init(configuration: RelayConfiguration? = RelayConfiguration.bundled()) {
        self.configuration = configuration
        isConfigured = configuration != nil
        let settings = URLSessionConfiguration.ephemeral
        settings.urlCache = nil
        settings.httpCookieStorage = nil
        networking = URLSession(configuration: settings)
        if configuration == nil { status = "Add RELAY_TOKEN to .env and rebuild" }
    }

    var room: String { configuration?.room ?? "table" }

    func connect() {
        guard receiver == nil, let configuration else { return }
        let id = UUID()
        runID = id
        receiver = Task { [weak self] in
            var attempt = 0
            while !Task.isCancelled {
                guard let self, self.runID == id else { return }
                self.status = attempt == 0 ? "Connecting…" : "Reconnecting…"
                self.connectionStarted = Date()
                let task = self.networking.webSocketTask(with: configuration.request())
                task.maximumMessageSize = 4 * 1024 * 1024
                self.socket = task
                task.resume()
                do {
                    while !Task.isCancelled {
                        let message = try await task.receive()
                        guard self.runID == id, !Task.isCancelled else { return }
                        switch message {
                        case .data(let data):
                            let frame = await Task.detached(priority: .userInitiated) { Self.decodeJPEG(data) }.value
                            guard self.runID == id, !Task.isCancelled else { return }
                            if let frame {
                                self.latestFrame = frame
                                self.lastFrameAt = Date()
                                self.framesReceived += 1
                                self.hasFreshFrame = true
                                self.status = "Live"
                                attempt = 0
                            } else {
                                self.rejectedFrames += 1
                            }
                        case .string(let text): self.handle(text)
                        @unknown default: break
                        }
                    }
                } catch {
                    guard self.runID == id, !Task.isCancelled else { return }
                    // Error descriptions may contain the authenticated request; expose only a generic status.
                    self.isConnected = false
                    self.hasFreshFrame = false
                    self.peers = []
                    self.lastFrameAt = nil
                    self.status = "Connection lost · retrying"
                    task.cancel(with: .goingAway, reason: nil)
                    attempt = min(attempt + 1, 4)
                    do { try await Task.sleep(for: .seconds(min(16, pow(2.0, Double(attempt))))) }
                    catch { return }
                }
            }
        }
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
                guard let self, self.runID == id else { return }
                if let last = self.lastFrameAt, Date().timeIntervalSince(last) > 3 {
                    self.hasFreshFrame = false
                    if self.isConnected { self.status = "Video paused · no recent frames" }
                }
                if !self.isConnected, Date().timeIntervalSince(self.connectionStarted) > 20 {
                    self.socket?.cancel(with: .goingAway, reason: nil)
                }
            }
        }
    }

    func disconnect() {
        runID = UUID()
        receiver?.cancel(); receiver = nil
        watchdog?.cancel(); watchdog = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        isConnected = false; hasFreshFrame = false
        lastFrameAt = nil; latestFrame = nil; peers = []
        status = isConfigured ? "Disconnected" : "Add RELAY_TOKEN to .env and rebuild"
    }

    func reconnect() { disconnect(); connect() }

    private func handle(_ text: String) {
        guard text.utf8.count <= 131_072, let data = text.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        switch message["type"] as? String {
        case "welcome":
            isConnected = true
            if !hasFreshFrame { status = "Connected · waiting for Pi video" }
            fallthrough
        case "presence":
            peers = (message["peers"] as? [[String: Any]])?.compactMap { $0["role"] as? String } ?? []
        case "error": status = "Relay rejected a message"
        default: break // Transcript/game message contracts are not defined by this view.
        }
    }

    nonisolated static func decodeJPEG(_ data: Data) -> CGImage? {
        guard data.count >= 3, data.count <= 4 * 1024 * 1024,
              data.starts(with: [0xff, 0xd8, 0xff]),
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = props[kCGImagePropertyPixelWidth] as? Int,
              let height = props[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 4096, height <= 4096 else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 1920,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true
        ] as CFDictionary)
    }
}
