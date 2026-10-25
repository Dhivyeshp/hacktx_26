// Direct Vision Pro -> Pi motor control (see hardware-spec.md and pi/motor_server.py).
//
//   let car = MotorClient(host: "192.168.1.50", token: "secret")
//   car.connect()
//   car.setForward(true)    // button down: drives at `speed`, resent 20x/s
//   car.setForward(false)   // button up: stop
//
// The Pi stops the motors if 300 ms pass without a command, so the drive
// message is resent every 50 ms for as long as forward is held.
import Foundation
import Observation

@Observable
final class MotorClient {
    var isConnected = false
    var speed = 0.5  // server also caps at MAX_SPEED (default 0.5)

    private let url: URL
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var ticker: Timer?

    init(host: String, token: String, port: Int = 8765) {
        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
        components.port = port
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        self.url = components.url!
    }

    func connect() {
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        isConnected = true
        listen(on: task)
    }

    func disconnect() {
        setForward(false)
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isConnected = false
    }

    func setForward(_ on: Bool) {
        ticker?.invalidate()
        ticker = nil
        guard on else { return send(["type": "stop"]) }
        sendDrive(left: speed, right: speed)
        ticker = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.sendDrive(left: self.speed, right: self.speed)
        }
    }

    func emergencyStop() {
        setForward(false)
    }

    private func sendDrive(left: Double, right: Double) {
        send(["type": "drive", "left": left, "right": right])
    }

    private func send(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { error in
            if let error { print("motor send failed: \(error)") }
        }
    }

    // Drain incoming frames (errors from the server); a failure means the link dropped.
    private func listen(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, task === self.task else { return }
            if case .failure = result {
                DispatchQueue.main.async {
                    self.ticker?.invalidate()
                    self.ticker = nil
                    self.isConnected = false
                }
                return
            }
            self.listen(on: task)
        }
    }
}
