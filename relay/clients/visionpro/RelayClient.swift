// Vision Pro side of the relay. Drop this file into the visionOS app target.
//
//   let relay = RelayClient(url: URL(string: "wss://<host>/ws")!, token: "...")
//   relay.connect()
//   relay.send(["type": "gm_choice", "option": 1, "target_player_id": 3])
//   relay.send(["type": "drive", "to": "pi", "left": 0.4, "right": 0.4])
//
// `latestFrame` updates with each JPEG from the Pi's webcam; `lastTelemetry`
// with each telemetry message. Both are observable from SwiftUI.
import Foundation
import Observation
import UIKit

@Observable
final class RelayClient {
    var latestFrame: UIImage?
    var lastTelemetry: [String: Any] = [:]
    var peers: [String] = []
    var isConnected = false
    var onMessage: (([String: Any]) -> Void)?

    private let url: URL
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)

    init(url: URL, token: String, room: String = "table") {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "role", value: "visionpro"),
            URLQueryItem(name: "room", value: room),
            URLQueryItem(name: "token", value: token),
        ]
        self.url = components.url!
    }

    func connect() {
        task?.cancel(with: .goingAway, reason: nil)
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = 4 * 1024 * 1024
        self.task = task
        task.resume()
        isConnected = true
        receive(on: task)
    }

    func send(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { error in
            if let error { print("relay send failed: \(error)") }
        }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, task === self.task else { return }
            switch result {
            case .success(.data(let jpeg)):
                let image = UIImage(data: jpeg)
                DispatchQueue.main.async { self.latestFrame = image }
            case .success(.string(let text)):
                guard let data = text.data(using: .utf8),
                      let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { break }
                DispatchQueue.main.async { self.handle(msg) }
            case .success:
                break
            case .failure(let error):
                print("relay disconnected: \(error); reconnecting")
                DispatchQueue.main.async { self.isConnected = false }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.connect() }
                return
            }
            self.receive(on: task)
        }
    }

    private func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "telemetry":
            lastTelemetry = msg
        case "presence", "welcome":
            peers = (msg["peers"] as? [[String: Any]])?.compactMap { $0["role"] as? String } ?? peers
        default:
            break
        }
        onMessage?(msg)
    }
}
