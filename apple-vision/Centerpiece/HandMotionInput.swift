import Foundation
import simd

/// Measures both the base and middle finger bends, without thumb or fingertip
/// positions. Angles make the classifier independent of hand size and rotation.
enum HandGripGeometry {
    /// A finger counts as closed only when clearly curled. Raised from 0.55
    /// after testing: a relaxed or half-cupped hand crossed the old threshold
    /// and read as a fist. The wide gap to `openThreshold` is deliberate
    /// hysteresis, so a hand hovering near the boundary does not flicker.
    static let fistThreshold: Float = 0.72
    static let openThreshold: Float = 0.25
    struct Joint {
        var position: SIMD3<Float>
        var isTracked: Bool
    }
    struct FingerBend {
        var base: Float
        var middle: Float
        var estimated: Bool
        var curl: Float { max(base, middle) }
    }

    static func measure(metacarpal: Joint, knuckle: Joint, intermediateBase: Joint,
                        intermediateTip: Joint, allowEstimatedJoints: Bool) -> FingerBend? {
        let estimated = ![metacarpal, knuckle, intermediateBase, intermediateTip].allSatisfy(\.isTracked)
        guard allowEstimatedJoints || !estimated,
              let base = bend(before: metacarpal.position, joint: knuckle.position, after: intermediateBase.position),
              let middle = bend(before: knuckle.position, joint: intermediateBase.position, after: intermediateTip.position)
        else { return nil }
        return FingerBend(base: base, middle: middle, estimated: estimated)
    }

    static func bend(before: SIMD3<Float>, joint: SIMD3<Float>, after: SIMD3<Float>) -> Float? {
        let palmBone = joint - before
        let fingerBone = after - joint
        let a = simd_length(palmBone), b = simd_length(fingerBone)
        guard a.isFinite, b.isFinite, a > 0.001, b > 0.001, a < 0.12, b < 0.12 else { return nil }
        let cosine = simd_dot(palmBone / a, fingerBone / b)
        guard cosine.isFinite else { return nil }
        return max(0, min(1, 1 - cosine))
    }

    /// Two agreeing fingers are required. With three, the median rejects one
    /// outlier; with two, conflicting measurements produce no gesture sample.
    static func combinedCurl(_ fingers: [Float?]) -> Float? {
        let valid = fingers.compactMap { $0 }.filter { $0.isFinite && (0...1).contains($0) }.sorted()
        guard valid.count >= 2 else { return nil }
        if valid.count >= 3 { return valid[valid.count / 2] }
        // Different fingers bend by different amounts. Agreement is about the
        // pose, not numeric closeness: 0.56 and 1.0 are both closed fingers.
        if valid[0] >= fistThreshold { return valid[0] }
        if valid[1] <= openThreshold { return valid[1] }
        if valid[0] > openThreshold && valid[1] < fistThreshold {
            return (valid[0] + valid[1]) / 2
        }
        return nil
    }
}

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

/// Fist/open-hand hysteresis, fresh samples, neutral reset and stable-start delay.
/// Pure input logic so the directional mapping can be checked without a headset.
struct HandMotionInput {
    static let trackingTimeout: TimeInterval = 0.25
    /// How long a new fist combination must hold before the wheels move.
    /// Longer than the original 0.16 so a hand passing through a curl on its
    /// way somewhere else does not start the robot.
    static let settleDelay: TimeInterval = 0.30
    private struct Sample {
        var curl: Float?
        var timestamp: TimeInterval = -.infinity
        var closed = false
    }
    private var left = Sample()
    private var right = Sample()
    private var releasedSince: TimeInterval?
    private var candidateSince: TimeInterval = 0
    private var candidate: HandDriveIntent = .stop
    private(set) var needsRelease = true
    private(set) var intent: HandDriveIntent = .stop

    var leftFist: Bool { left.closed }
    var rightFist: Bool { right.closed }
    var leftCurl: Float? { left.curl }
    var rightCurl: Float? { right.curl }
    func isFresh(leftHand: Bool, at now: TimeInterval) -> Bool {
        let sample = leftHand ? left : right
        return sample.curl != nil && now - sample.timestamp < Self.trackingTimeout
    }
    func bothFresh(at now: TimeInterval) -> Bool {
        isFresh(leftHand: true, at: now) && isFresh(leftHand: false, at: now)
    }

    mutating func update(leftHand: Bool, curl: Float?, at now: TimeInterval,
                         handTracked: Bool = true) {
        var sample = leftHand ? left : right
        // Check the old valid timestamp BEFORE replacing it. A resumed stream
        // must not hide a long gap, even if step() wasn't called during the gap.
        if !handTracked || now - sample.timestamp >= Self.trackingTimeout {
            reset()
            sample.closed = false
        }
        sample.curl = handTracked ? curl.flatMap { $0.isFinite && (0...1).contains($0) ? $0 : nil } : nil
        if let curl = sample.curl {
            sample.timestamp = now
            if curl >= HandGripGeometry.fistThreshold { sample.closed = true }
            else if curl <= HandGripGeometry.openThreshold { sample.closed = false }
        } else {
            // Never drive without enough finger evidence. A short dropout preserves
            // the completed neutral reset, but cancels the pending direction.
            pause()
            if curl != nil { reset() } // Reject corrupt numeric samples.
        }
        if leftHand { left = sample } else { right = sample }
    }

    mutating func reset() {
        needsRelease = true
        pause()
    }

    private mutating func pause() {
        releasedSince = nil
        candidate = .stop
        intent = .stop
    }

    mutating func step(at now: TimeInterval, enabled: Bool) -> HandDriveIntent {
        guard enabled else { reset(); return .stop }
        guard bothFresh(at: now) else {
            if now - left.timestamp >= Self.trackingTimeout || now - right.timestamp >= Self.trackingTimeout {
                reset()
            } else {
                pause()
            }
            return .stop
        }
        if needsRelease {
            // An ambiguous, partly curled hand must not count as open at startup.
            guard let l = left.curl, let r = right.curl,
                  l <= HandGripGeometry.openThreshold, r <= HandGripGeometry.openThreshold else {
                releasedSince = nil; return .stop
            }
            if releasedSince == nil { releasedSince = now }
            if now - releasedSince! >= 0.15 { needsRelease = false }
            return .stop
        }
        let next: HandDriveIntent
        switch (left.closed, right.closed) {
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
        } else if now - candidateSince >= Self.settleDelay {
            intent = next
        }
        return intent
    }
}
