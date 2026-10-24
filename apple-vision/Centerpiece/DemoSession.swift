import Foundation
import Observation

struct Challenge: Identifiable, Equatable {
    let id: Int
    let kind: String
    let title: String
    let target: String
    let partner: String
    let reason: String
    let symbol: String
    let duration: String

    static let samples: [Challenge] = [
        .init(id: 0, kind: "HOT SEAT", title: "Your next great adventure", target: "Maya", partner: "Everyone guesses",
              reason: "Maya has spoken 6% of this round. Give her the spotlight with a question about her dream climbing trip.",
              symbol: "sparkles", duration: "60 sec"),
        .init(id: 1, kind: "DUEL", title: "Mountains or the ocean?", target: "Jordan", partner: "vs. Alex",
              reason: "Jordan and Alex love the outdoors, but disagree on the perfect escape. Let the table settle it.",
              symbol: "bolt.fill", duration: "90 sec"),
        .init(id: 2, kind: "FORGE", title: "Invent a tiny escape", target: "Sam", partner: "with Maya",
              reason: "Sam loves design. Maya loves adventure. Together, describe a pocket-sized cabin for the wild.",
              symbol: "cube.transparent.fill", duration: "45 sec")
    ]
}

@MainActor @Observable
final class DemoSession {
    enum Phase: String {
        case ready = "Ready for your pick"
        case sending = "Sending your choice"
        case delivering = "Delivering capsule"
        case complete = "Capsule delivered"
        case stopped = "Delivery stopped"
        case failed = "Robot needs attention"
    }

    var selectedID = 0
    var phase: Phase = .ready
    var cameraPaused = false
    var simulateFailure = false
    var progress = 0.0
    private var deliveryTask: Task<Void, Never>?

    var selected: Challenge { Challenge.samples.first { $0.id == selectedID } ?? Challenge.samples[0] }
    var isBusy: Bool { phase == .sending || phase == .delivering }
    var canSelect: Bool { phase == .ready }
    var detail: String {
        switch phase {
        case .ready: return "Choose a challenge. You make the final call."
        case .sending: return "Waiting for the simulated robot to accept your choice…"
        case .delivering: return "Slot 03 is rotating toward the delivery arm."
        case .complete: return "Ready for \(selected.target) to collect. Reset to try another option."
        case .stopped: return "The simulated motion has stopped. Reset when you’re ready."
        case .failed: return "The simulated arm is blocked. Reset to try again."
        }
    }

    func deliver() {
        guard canSelect else { return }
        phase = .sending
        progress = 0
        let shouldFail = simulateFailure
        deliveryTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(1))
                guard let self else { return }
                self.phase = .delivering
                for step in 1...20 {
                    try await Task.sleep(for: .milliseconds(200))
                    self.progress = Double(step) / 20
                    if shouldFail && step == 10 {
                        self.phase = .failed
                        return
                    }
                }
                self.phase = .complete
            } catch { /* Stop/reset cancels the demo before it can report completion. */ }
        }
    }

    func stop() {
        guard isBusy else { return }
        deliveryTask?.cancel()
        deliveryTask = nil
        phase = .stopped
    }

    func reset() {
        deliveryTask?.cancel()
        deliveryTask = nil
        phase = .ready
        progress = 0
    }
}
