import Foundation

/// A hand gesture maps to robot direction; left/right in the wire message are wheels.
enum HandDriveIntent: String, Equatable {
    case stop = "Stopped"
    case straight = "Straight"
    case left = "Turn left"
    case right = "Turn right"

    var wheels: WheelCommand {
        switch self {
        case .stop: return WheelCommand(left: 0, right: 0)
        case .straight: return WheelCommand(left: 0.35, right: 0.35)
        case .left: return WheelCommand(left: 0, right: 0.35)
        case .right: return WheelCommand(left: 0.35, right: 0)
        }
    }
}

/// Hysteresis, fresh samples from BOTH hands, neutral reset and stable-start delay.
/// Pure input logic so the directional mapping can be checked without a headset.
struct HandMotionInput {
    private struct Sample {
        var distance: Float?
        var timestamp: TimeInterval = -.infinity
        var pinched = false
    }
    private var left = Sample()
    private var right = Sample()
    private var releasedSince: TimeInterval?
    private var candidateSince: TimeInterval = 0
    private var candidate: HandDriveIntent = .stop
    private(set) var needsRelease = true
    private(set) var intent: HandDriveIntent = .stop

    var leftPinched: Bool { left.pinched }
    var rightPinched: Bool { right.pinched }
    func bothFresh(at now: TimeInterval) -> Bool {
        left.distance != nil && right.distance != nil
            && now - left.timestamp < 0.25 && now - right.timestamp < 0.25
    }

    mutating func update(leftHand: Bool, distance: Float?, at now: TimeInterval) {
        var sample = leftHand ? left : right
        sample.timestamp = now
        sample.distance = distance.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
        if let distance = sample.distance {
            if distance < 0.022 { sample.pinched = true }
            else if distance > 0.035 { sample.pinched = false }
        } else { sample.pinched = false }
        if leftHand { left = sample } else { right = sample }
    }

    mutating func reset() {
        needsRelease = true
        releasedSince = nil
        candidate = .stop
        intent = .stop
    }

    mutating func step(at now: TimeInterval, enabled: Bool) -> HandDriveIntent {
        guard enabled, bothFresh(at: now) else { reset(); return .stop }
        if needsRelease {
            guard !left.pinched, !right.pinched else { releasedSince = nil; return .stop }
            if releasedSince == nil { releasedSince = now }
            if now - releasedSince! >= 0.15 { needsRelease = false }
            return .stop
        }
        let next: HandDriveIntent
        switch (left.pinched, right.pinched) {
        case (true, true): next = .straight
        case (true, false): next = .left
        case (false, true): next = .right
        default: next = .stop
        }
        if next == .stop {
            candidate = .stop; intent = .stop
            return .stop
        }
        if next != candidate {
            candidate = next; candidateSince = now
            // Stop while a new combination settles; do not sweep through a turn
            // as the wearer closes both hands a few frames apart.
            intent = .stop
        } else if now - candidateSince >= 0.16 {
            intent = next
        }
        return intent
    }
}
