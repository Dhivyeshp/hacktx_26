import Foundation
import Observation
import CoreGraphics

struct Player: Identifiable, Equatable {
    let id: Int
    let name: String
    let initials: String
    let questions: [String]

    static let samples = [
        Player(id: 0, name: "Maya", initials: "MA", questions: ["Where would you go on your dream climbing trip?", "What adventure would you take everyone here on?", "What’s something you’ve always wanted to try?"]),
        Player(id: 1, name: "Jordan", initials: "JO", questions: ["Mountains or ocean — and who here would you bring?", "What’s your most memorable outdoor adventure?", "What could you teach someone at this table?"]),
        Player(id: 2, name: "Alex", initials: "AL", questions: ["What’s a place you think everyone should visit?", "Which person here would be your ideal travel partner?", "What opinion of yours would surprise this group?"]),
        Player(id: 3, name: "Sam", initials: "SA", questions: ["What would your dream tiny cabin look like?", "What would you build with someone at this table?", "What’s the most creative thing you’ve ever made?"])
    ]
}

/// Local demo only. A future transport can send this selection and report its acknowledgment.
struct QuestionSelection: Equatable {
    let playerID: Int
    let playerName: String
    let questionIndex: Int
    let question: String
}

/// The system's pinch-and-drag translation, normalized into a bounded drive intent.
/// Up drives forward; sideways turns. A central dead zone avoids drift.
struct DriveInput: Equatable {
    static let radius: CGFloat = 56
    static let zero = DriveInput(translation: .zero)
    let forward: Float
    let turn: Float
    let offset: CGSize

    init(translation: CGSize) {
        guard translation.width.isFinite, translation.height.isFinite else {
            forward = 0; turn = 0; offset = .zero
            return
        }
        let length = hypot(translation.width, translation.height)
        let scale = length > Self.radius ? Self.radius / length : 1
        let x = translation.width * scale / Self.radius
        let y = translation.height * scale / Self.radius
        offset = CGSize(width: x * Self.radius, height: y * Self.radius)
        func axis(_ value: CGFloat) -> Float {
            let deadZone: CGFloat = 0.12
            guard abs(value) > deadZone else { return 0 }
            return Float((value > 0 ? 1 : -1) * (abs(value) - deadZone) / (1 - deadZone))
        }
        forward = max(0, axis(-y))
        turn = axis(x)
    }
}

struct WheelCommand: Equatable {
    let left: Float
    let right: Float

    init(forward: Float, turn: Float) {
        let rawLeft = forward + turn
        let rawRight = forward - turn
        let divisor = max(1, max(abs(rawLeft), abs(rawRight)))
        // Limit this MVP's eventual drive output to 60 percent.
        left = rawLeft / divisor * 0.6
        right = rawRight / divisor * 0.6
    }
}

enum DropPhase: String {
    case ready = "Ready"
    case updating = "Updating shared URL…"
    case dispensing = "Dispensing capsule…"
    case delivered = "Capsule dropped"
    case failed = "Demo request failed"
    case stopped = "Stopped"
}

enum DemoFailure: String, CaseIterable {
    case none = "None"
    case questionUpdate = "URL update fails"
    case dispenser = "Dispenser fails"
}

@MainActor @Observable
final class DemoSession {
    var selectedPlayerID: Int?
    var selectedQuestionIndex: Int?
    private(set) var isDriving = false
    private(set) var armed = false
    private(set) var phase: DropPhase = .ready
    private(set) var activeQuestion: QuestionSelection?
    private(set) var roundInProgress = false
    var controlsSuspended = false
    private(set) var status = "Choose a player, then a question."
    private(set) var forward: Float = 0
    private(set) var turn: Float = 0
    private(set) var travel: Float = 0
    private(set) var heading: Float = 0
    private(set) var events: [String] = []
    private(set) var driveGestureID: UUID?
    var driveGestureActive: Bool { driveGestureID != nil }
    private(set) var armingID: UUID?
    var cameraAvailable = true
    var failure: DemoFailure = .none
    private var dropTask: Task<Void, Never>?
    private var lastMotionTime: Date?

    var selectedPlayer: Player? { Player.samples.first { $0.id == selectedPlayerID } }
    var selection: QuestionSelection? {
        guard let player = selectedPlayer, let index = selectedQuestionIndex,
              player.questions.indices.contains(index) else { return nil }
        return QuestionSelection(playerID: player.id, playerName: player.name,
                                 questionIndex: index, question: player.questions[index])
    }
    var isBusy: Bool { phase == .updating || phase == .dispensing }
    var isMoving: Bool { abs(forward) > 0.01 || abs(turn) > 0.01 }
    var canDrive: Bool { isDriving && selection != nil && phase == .ready && cameraAvailable && !controlsSuspended }
    var canArm: Bool { canDrive && !driveGestureActive && !isMoving }
    var canDrop: Bool { canArm && armed }
    var wheelCommand: WheelCommand { WheelCommand(forward: forward, turn: turn) }
    var motionLabel: String {
        if !isMoving { return driveGestureActive ? "Pinch held · centered" : "Stopped" }
        if forward > 0.01 {
            return abs(turn) > 0.01 ? "Forward + turn \(turn > 0 ? "right" : "left")" : "Moving forward"
        }
        return "Turning \(turn > 0 ? "right" : "left")"
    }

    func selectPlayer(_ player: Player) {
        guard !isDriving, !isBusy, !roundInProgress, player.id != selectedPlayerID else { return }
        selectedPlayerID = player.id
        selectedQuestionIndex = nil
        status = "Choose a question for \(player.name)."
    }
    func selectQuestion(_ index: Int) {
        guard !isDriving, !isBusy, !roundInProgress,
              let player = selectedPlayer, player.questions.indices.contains(index) else { return }
        selectedQuestionIndex = index
        status = "Ready to position the robot for \(player.name)."
    }
    func enterDriving() {
        guard selection != nil, !roundInProgress else { return }
        isDriving = true
        phase = .ready
        status = "Position the robot, stop, then arm the drop."
    }
    func editSelection() {
        guard !isBusy, !roundInProgress else { return }
        halt()
        isDriving = false
        phase = .ready
        status = "Choose a player and question."
    }
    @discardableResult
    func beginDrive() -> UUID? {
        guard canDrive else { return nil }
        if let driveGestureID { return driveGestureID }
        disarm()
        driveGestureID = UUID()
        lastMotionTime = Date()
        return driveGestureID
    }
    func updateDrive(_ input: DriveInput, gestureID: UUID? = nil) {
        guard gestureID == nil || gestureID == driveGestureID else { return }
        move(forward: input.forward, turn: input.turn)
    }
    func arm() {
        guard canArm else { return }
        armed = true
        armingID = UUID()
        status = "Armed. Look at Drop and pinch-and-hold to release one capsule."
    }
    func move(forward: Float, turn: Float) {
        guard driveGestureActive, canDrive, forward.isFinite, turn.isFinite else { endDrive(); return }
        self.forward = max(0, min(1, forward))
        self.turn = max(-1, min(1, turn))
        disarm()
        lastMotionTime = Date()
    }
    func endDrive(gestureID: UUID? = nil) {
        guard gestureID == nil || gestureID == driveGestureID else { return }
        driveGestureID = nil
        forward = 0; turn = 0; lastMotionTime = nil
    }
    func halt() { endDrive(); disarm() }
    private func disarm() { armed = false; armingID = nil }
    func tick() {
        if let lastMotionTime, Date().timeIntervalSince(lastMotionTime) > 0.25 { halt() }
        travel += forward * 0.025
        heading += turn * 0.018
    }
    func cameraChanged() {
        if !cameraAvailable { emergencyStop(); status = "Demo video lost. Movement and drop disabled." }
    }
    func emergencyStop() {
        dropTask?.cancel()
        dropTask = nil
        halt()
        if isDriving { phase = .stopped }
        status = activeQuestion == nil ? "Stopped. No capsule dispensed." : "Stopped. Shared page still holds the assigned question."
        log("STOP: local demo canceled")
    }
    func drop(armedWith expectedID: UUID? = nil) {
        guard canDrop, let request = selection,
              expectedID == nil || expectedID == armingID else { return }
        halt()
        phase = .updating
        status = "Assigning \(request.playerName)’s question to the shared page…"
        log("URL update requested for \(request.playerName)")
        let failure = failure
        dropTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(1))
                guard let self else { return }
                if failure == .questionUpdate {
                    self.phase = .failed
                    self.status = "URL update failed. No dispense command was sent."
                    self.log("URL update failed → dispenser not called")
                    return
                }
                self.activeQuestion = request
                self.roundInProgress = true
                self.log("Shared URL updated (simulated acknowledgment)")
                self.phase = .dispensing
                self.status = "Question is loaded. Releasing one capsule…"
                self.log("Dispense requested")
                try await Task.sleep(for: .seconds(1.2))
                if failure == .dispenser {
                    self.phase = .failed
                    self.status = "Dispenser failed. The shared page already has this question."
                    self.log("Dispense failed")
                    return
                }
                self.phase = .delivered
                self.status = "Capsule dropped for \(request.playerName). Tap any tag to read the question."
                self.log("One capsule dispensed (simulated acknowledgment)")
            } catch { }
        }
    }
    func finishRound() {
        guard !isBusy else { return }
        halt()
        roundInProgress = false
        selectedQuestionIndex = nil
        isDriving = false
        phase = .ready
        status = "Round finished. Choose the next question."
        log("Round finished; ready for a new assignment")
    }
    private func log(_ event: String) {
        events.append(event)
        if events.count > 12 { events.removeFirst() }
    }
}
