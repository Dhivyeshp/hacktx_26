import Foundation
import Observation
import ImageIO

struct RelayConfiguration {
    let url: URL
    let token: String
    let room: String

    static func bundled(bundle: Bundle = .main) -> RelayConfiguration? {
        guard let path = bundle.url(forResource: "RelayConfig", withExtension: "plist"),
              let data = try? Data(contentsOf: path),
              let values = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String],
              let rawURL = values["url"], let url = URL(string: rawURL),
              ["ws", "wss"].contains(url.scheme ?? ""), let host = url.host, !host.isEmpty,
              let token = values["token"], token != "YOUR_RELAY_TOKEN" else { return nil }
        return RelayConfiguration(url: url, token: token, room: values["room"] ?? "table")
    }

    func request() -> URLRequest {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "role", value: "visionpro"),
                                 URLQueryItem(name: "room", value: room), URLQueryItem(name: "video", value: "1")]
        var request = URLRequest(url: components.url!)
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = 20
        return request
    }
}

/// Video and wheel-control client for the sibling relay.
/// Never log URLs, credentials, or raw server errors.
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
    @ObservationIgnored private var writer: Task<Void, Never>?
    @ObservationIgnored private var writerID: UUID?
    @ObservationIgnored private var pendingDrive: (left: Float, right: Float)?
    @ObservationIgnored private var pendingStop = false
    @ObservationIgnored private var ownsMotion = false
    private(set) var motionStatus = "Wheel control idle"

    /// The first unmet precondition for sending wheel commands, or nil when ready.
    /// A `pi` peer and recent video are both required, so a Pi that is not
    /// streaming reads as "no video" rather than as a dropped command.
    var controlBlockReason: String? {
        if !isConnected { return "relay not connected" }
        if !peers.contains("pi") { return "no pi client in room \(room)" }
        if !hasFreshFrame { return "no Pi video in the last 3s" }
        return nil
    }
    var canControlRobot: Bool { controlBlockReason == nil }

    func sendDrive(left: Float, right: Float) {
        guard canControlRobot, left.isFinite, right.isFinite else { stopRobot(); return }
        let left = max(-0.6, min(0.6, left))
        let right = max(-0.6, min(0.6, right))
        if left == 0 && right == 0 { stopRobot(); return }
        ownsMotion = true
        pendingDrive = (left, right)
        startWriter()
    }

    /// Report why no wheel command is going out. Ignored while this client owns
    /// motion so a live command's own status is never overwritten.
    func noteMotionIdle(_ reason: String?) {
        guard let reason, !ownsMotion else { return }
        motionStatus = "Wheels idle · \(reason)"
    }

    func stopRobot() {
        pendingDrive = nil
        guard ownsMotion else { return }
        pendingStop = true
        startWriter()
    }

    private func startWriter() {
        guard writer == nil, let task = socket, isConnected else { return }
        let id = runID
        let writingID = UUID()
        writerID = writingID
        writer = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.writerID == writingID { self.writer = nil; self.writerID = nil }
            }
            do {
                while !Task.isCancelled, self.runID == id {
                    if self.pendingStop {
                        self.pendingStop = false
                        // Match both wheel-command semantics and the Pi's explicit stop.
                        try await task.send(.string(Self.driveJSON(left: 0, right: 0)))
                        try await task.send(.string("{\"type\":\"stop\",\"to\":\"pi\"}"))
                        if self.pendingDrive == nil { self.ownsMotion = false }
                        self.motionStatus = "Stop sent"
                    } else if let drive = self.pendingDrive {
                        self.pendingDrive = nil
                        try await task.send(.string(Self.driveJSON(left: drive.left, right: drive.right)))
                        self.motionStatus = "Wheel command sent"
                    } else { return }
                }
            } catch {
                guard self.runID == id, self.writerID == writingID else { return }
                self.pendingDrive = nil
                self.pendingStop = false
                self.ownsMotion = false
                let failure = error as NSError
                print("[relay] Send failed: domain=\(failure.domain) code=\(failure.code) close=\(task.closeCode.rawValue)")
                self.motionStatus = "Control connection failed"
                task.cancel(with: .goingAway, reason: nil)
            }
        }
    }

    nonisolated static func driveJSON(left: Float, right: Float) -> String {
        // Values are bounded and finite before reaching this function.
        let message: [String: Any] = ["type": "drive", "to": "pi", "left": left, "right": right]
        let data = try! JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    private func cancelWriter() {
        writerID = nil
        writer?.cancel(); writer = nil
        pendingDrive = nil; pendingStop = false
    }

    init(configuration: RelayConfiguration? = RelayConfiguration.bundled()) {
        self.configuration = configuration
        isConfigured = configuration != nil
        let settings = URLSessionConfiguration.ephemeral
        settings.urlCache = nil
        settings.httpCookieStorage = nil
        networking = URLSession(configuration: settings)
        if configuration == nil { status = "Check relay configuration and rebuild" }
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
                print("[relay] Connecting, attempt \(attempt + 1)")
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
                    // Log only numeric/domain diagnostics; error descriptions can include credentials.
                    let failure = error as NSError
                    print("[relay] Receive failed: domain=\(failure.domain) code=\(failure.code) close=\(task.closeCode.rawValue)")
                    self.cancelWriter()
                    self.ownsMotion = false
                    self.motionStatus = "Control disconnected · enable hands again"
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
                    self.stopRobot()
                    if self.isConnected { self.status = "Video paused · no recent frames" }
                }
                if !self.isConnected, Date().timeIntervalSince(self.connectionStarted) > 20 {
                    self.socket?.cancel(with: .goingAway, reason: nil)
                }
            }
        }
    }

    func disconnect(reason: String = "requested") {
        print("[relay] Disconnect requested: \(reason)")
        let oldSocket = socket
        let shouldStop = ownsMotion
        cancelWriter()
        ownsMotion = false
        runID = UUID()
        receiver?.cancel(); receiver = nil
        watchdog?.cancel(); watchdog = nil
        socket = nil
        if let oldSocket, shouldStop {
            // Send stop on the old socket before closing it. This callback cannot
            // mutate a newly opened connection. Bound cleanup if the network hangs.
            oldSocket.send(.string(Self.driveJSON(left: 0, right: 0))) { _ in
                oldSocket.send(.string("{\"type\":\"stop\",\"to\":\"pi\"}")) { _ in
                    oldSocket.cancel(with: .goingAway, reason: nil)
                }
            }
            Task {
                try? await Task.sleep(for: .milliseconds(500))
                oldSocket.cancel(with: .goingAway, reason: nil)
            }
        } else { oldSocket?.cancel(with: .goingAway, reason: nil) }
        isConnected = false; hasFreshFrame = false
        lastFrameAt = nil; latestFrame = nil; peers = []
        status = isConfigured ? "Disconnected" : "Check relay configuration and rebuild"
    }

    func reconnect() { disconnect(reason: "manual reconnect"); connect() }

    private func handle(_ text: String) {
        guard text.utf8.count <= 131_072, let data = text.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        switch message["type"] as? String {
        case "welcome":
            print("[relay] Welcome received; socket connected")
            isConnected = true
            if !hasFreshFrame { status = "Connected · waiting for Pi video" }
            fallthrough
        case "presence":
            peers = (message["peers"] as? [[String: Any]])?.compactMap { $0["role"] as? String } ?? []
            if !peers.contains("pi") { stopRobot() }
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
