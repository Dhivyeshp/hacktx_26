import Foundation
import CoreGraphics

@main
struct HandMotionChecks {
    @MainActor static func main() {
        checkGripGeometry()
        var input = HandMotionInput()
        func update(_ time: Double, _ left: Float?, _ right: Float?) {
            input.update(leftHand: true, curl: left, at: time)
            input.update(leftHand: false, curl: right, at: time)
        }
        update(0, 0.9, 0.9)
        assert(input.step(at: 0, enabled: true) == .stop && input.needsRelease)
        update(0.1, 0.05, 0.05)
        assert(input.step(at: 0.1, enabled: true) == .stop)
        update(0.3, 0.05, 0.05)
        assert(input.step(at: 0.3, enabled: true) == .stop && !input.needsRelease)
        update(0.31, 0.9, 0.9)
        assert(input.step(at: 0.31, enabled: true) == .stop)
        update(0.5, 0.9, 0.9)
        assert(input.step(at: 0.5, enabled: true) == .straight)
        assert(input.intent.wheels == WheelCommand(left: 0.35, right: 0.35))
        update(0.51, 0.9, 0.05)
        assert(input.step(at: 0.51, enabled: true) == .stop)
        update(0.7, 0.9, 0.05)
        assert(input.step(at: 0.7, enabled: true) == .left)
        assert(input.intent.wheels == WheelCommand(left: 0, right: 0.35))
        update(0.71, 0.4, 0.05)
        assert(input.step(at: 0.71, enabled: true) == .left, "Hysteresis must reject fist jitter")
        update(0.72, 0.05, 0.9)
        assert(input.step(at: 0.72, enabled: true) == .stop)
        update(0.9, 0.05, 0.9)
        assert(input.step(at: 0.9, enabled: true) == .right)
        assert(input.intent.wheels == WheelCommand(left: 0.35, right: 0))
        update(0.91, 0.05, 0.05)
        assert(input.step(at: 0.91, enabled: true) == .stop, "Releasing both stops immediately")
        input.update(leftHand: true, curl: 0.9, at: 1.2)
        assert(input.step(at: 1.2, enabled: true) == .stop && input.needsRelease, "Missing right hand stops instead of turning")
        update(1.21, 0.9, 0.9)
        assert(input.step(at: 1.21, enabled: true) == .stop, "Reacquiring held fists cannot resume motion")
        update(1.3, 0.05, 0.05); _ = input.step(at: 1.3, enabled: true)
        update(1.5, 0.05, 0.05); _ = input.step(at: 1.5, enabled: true)
        update(1.51, 0.9, 0.9); _ = input.step(at: 1.51, enabled: true)
        update(1.7, 0.9, 0.9)
        assert(input.step(at: 1.7, enabled: true) == .straight)
        assert(input.step(at: 1.7, enabled: false) == .stop && input.needsRelease)
        update(1.71, nil, 0.9)
        assert(input.step(at: 1.71, enabled: true) == .stop)
        update(1.8, .nan, 0.9)
        assert(!input.bothFresh(at: 1.8))
        checkTrackingRecovery()
        let model = DemoSession()
        model.selectPlayer(Player.samples[0]); model.selectQuestion(0); model.enterDriving()
        model.enableHandDriving()
        let gesture = model.beginDrive()!
        model.applyHandWheels(HandDriveIntent.left.wheels, gestureID: gesture)
        assert(model.wheelCommand == WheelCommand(left: 0, right: 0.35))
        model.enableHandDriving()
        assert(model.handDrivingEnabled && model.driveGestureID == gesture,
               "Selecting Enable again must preserve the active gesture")
        assert(model.wheelCommand == WheelCommand(left: 0, right: 0.35),
               "Selecting Enable again must not halt active driving")
        model.endDrive(gestureID: gesture)
        assert(model.wheelCommand == .zero)
        model.applyHandWheels(HandDriveIntent.straight.wheels, gestureID: gesture)
        assert(model.wheelCommand == .zero, "A released gesture cannot resume wheels")
        let nextGesture = model.beginDrive()!
        model.applyHandWheels(HandDriveIntent.straight.wheels, gestureID: nextGesture)
        model.setSceneActive(false)
        assert(model.handDrivingEnabled && !model.canDrive && model.wheelCommand == .zero,
               "Inactivity must stop wheels while preserving enablement")
        assert(model.beginDrive() == nil, "An inactive scene must not start driving")
        model.applyHandWheels(HandDriveIntent.straight.wheels, gestureID: nextGesture)
        assert(model.wheelCommand == .zero, "Inactive scenes must reject wheel updates")
        model.setSceneActive(true)
        assert(model.canDrive && model.wheelCommand == .zero && model.driveGestureID == nil,
               "Returning to active must not replay motion")
        model.applyHandWheels(HandDriveIntent.straight.wheels, gestureID: nextGesture)
        assert(model.wheelCommand == .zero, "An old gesture must remain invalid after focus returns")
        model.emergencyStop()
        assert(!model.handDrivingEnabled && model.wheelCommand == .zero)
        print("PASS: straight/left/right wheel mapping, neutral reset, stable starts, release stop, fist hysteresis, missing/stale hands, interruption, invalid samples")
    }

    static func drivingInput() -> HandMotionInput {
        var input = HandMotionInput()
        for time in [0.0, 0.16] {
            input.update(leftHand: true, curl: 0.05, at: time)
            input.update(leftHand: false, curl: 0.05, at: time)
            assert(input.step(at: time, enabled: true) == .stop)
        }
        for time in [0.17, 0.34] {
            input.update(leftHand: true, curl: 0.9, at: time)
            input.update(leftHand: false, curl: 0.9, at: time)
            _ = input.step(at: time, enabled: true)
        }
        assert(input.intent == .straight && !input.needsRelease)
        return input
    }

    static func checkGripGeometry() {
        let base = SIMD3<Float>(0, 0, 0)
        let knuckle = SIMD3<Float>(0, 0.05, 0)
        let open = SIMD3<Float>(0, 0.08, 0)
        let curled = SIMD3<Float>(0, 0.05, 0.03)
        let openScore = HandGripGeometry.bend(before: base, joint: knuckle, after: open)!
        let fistScore = HandGripGeometry.bend(before: base, joint: knuckle, after: curled)!
        assert(openScore < 0.01 && fistScore > 0.99, "Straight and bent knuckles must be distinct")
        func transformed(_ p: SIMD3<Float>) -> SIMD3<Float> {
            SIMD3(-p.y, p.x, p.z) * 1.7 + SIMD3(0.2, -0.3, 0.7)
        }
        let transformedScore = HandGripGeometry.bend(before: transformed(base), joint: transformed(knuckle),
                                                     after: transformed(curled))!
        assert(abs(transformedScore - fistScore) < 0.001, "Recognition must tolerate hand rotation, position and size")
        assert(HandGripGeometry.bend(before: base, joint: base, after: open) == nil)
        assert(HandGripGeometry.bend(before: base, joint: knuckle, after: SIMD3(.nan, 0, 0)) == nil)
        assert(HandGripGeometry.bend(before: base, joint: knuckle, after: SIMD3(1, 1, 1)) == nil)

        // A finger can curl at its middle joint while the base stays straight.
        // The former base-only fixtures could not catch this failure mode.
        let middleFold = SIMD3<Float>(0, 0.08, 0.025)
        func measure(_ last: SIMD3<Float>, tracked: Bool, allowEstimated: Bool) -> HandGripGeometry.FingerBend? {
            HandGripGeometry.measure(metacarpal: .init(position: base, isTracked: true),
                                     knuckle: .init(position: knuckle, isTracked: true),
                                     intermediateBase: .init(position: open, isTracked: tracked),
                                     intermediateTip: .init(position: last, isTracked: tracked),
                                     allowEstimatedJoints: allowEstimated)
        }
        let bent = measure(middleFold, tracked: true, allowEstimated: false)!
        assert(bent.base < 0.01 && bent.middle > 0.99 && bent.curl >= HandGripGeometry.fistThreshold,
               "A middle-joint curl must be recognized even with a straight base")
        let estimated = measure(middleFold, tracked: false, allowEstimated: true)!
        assert(estimated.estimated && estimated.curl == bent.curl,
               "visionOS 26 occlusion flags must not discard plausible current finger poses")
        assert(measure(middleFold, tracked: false, allowEstimated: false) == nil,
               "Older systems retain the tracked-joint requirement")
        assert(measure(SIMD3(0, 0.105, 0), tracked: false, allowEstimated: true)!.curl < 0.01,
               "Occlusion alone must never be interpreted as a fist")
        assert(measure(SIMD3(.nan, 0, 0), tracked: false, allowEstimated: true) == nil,
               "Estimated joints still need valid geometry")
        assert(measure(open, tracked: false, allowEstimated: true) == nil)
        let rotated = HandGripGeometry.measure(
            metacarpal: .init(position: transformed(base), isTracked: true),
            knuckle: .init(position: transformed(knuckle), isTracked: true),
            intermediateBase: .init(position: transformed(open), isTracked: false),
            intermediateTip: .init(position: transformed(middleFold), isTracked: false),
            allowEstimatedJoints: true)!
        assert(abs(rotated.curl - bent.curl) < 0.001)

        var occluded = drivingInput()
        for i in 1...20 {
            let time = 0.34 + Double(i) * 0.03
            let score = HandGripGeometry.combinedCurl([estimated.curl, estimated.curl, nil])
            occluded.update(leftHand: true, curl: score, at: time)
            occluded.update(leftHand: false, curl: score, at: time)
            assert(occluded.step(at: time, enabled: true) == .straight)
        }
        occluded.update(leftHand: true, curl: estimated.curl, at: 0.95, handTracked: false)
        assert(occluded.step(at: 0.95, enabled: true) == .stop && occluded.needsRelease,
               "Estimated finger poses cannot override whole-hand loss")
        assert(occluded.step(at: 1.3, enabled: true) == .stop,
               "Estimated finger poses cannot override stale samples")
        assert(HandGripGeometry.combinedCurl([1, 1, nil]) == 1, "Two fingers can recognize a fist without the third")
        assert(HandGripGeometry.combinedCurl([0, 0, 1]) == 0, "One bent finger must not look like a fist")
        assert(HandGripGeometry.combinedCurl([1, 1, 0]) == 1, "One outlier must not break a held fist")
        assert(HandGripGeometry.combinedCurl([0, 1, nil]) == nil, "Two conflicting fingers provide no decision")
        assert(HandGripGeometry.combinedCurl([1, nil, nil]) == nil, "One finger is insufficient")
        assert(HandGripGeometry.combinedCurl([0.56, 1, nil]) == 0.56,
               "Two closed fingers must agree even when their bend amounts differ widely")
        assert(HandGripGeometry.combinedCurl([0, 0.24, nil]) == 0.24)
        assert(HandGripGeometry.combinedCurl([0.5, 0.6, nil]) == nil,
               "Do not average an ambiguous and closed finger into a new fist")

        var input = drivingInput()
        for i in 1...50 {
            let time = 0.34 + Double(i) * 0.03
            let curl = HandGripGeometry.combinedCurl(i.isMultiple(of: 2) ? [0.56, nil, 1] : [0.9, 0.9, 0])
            input.update(leftHand: true, curl: curl, at: time)
            input.update(leftHand: false, curl: curl, at: time)
            assert(input.step(at: time, enabled: true) == .straight,
                   "One missing/noisy finger must not produce repeated drive/stop bursts")
        }
        input.update(leftHand: true, curl: openScore, at: 1.85)
        input.update(leftHand: false, curl: openScore, at: 1.85)
        assert(input.step(at: 1.85, enabled: true) == .stop, "Opening hands must stop immediately")

        var partial = HandMotionInput()
        for time in [0.0, 0.16, 0.32] {
            partial.update(leftHand: true, curl: 0.4, at: time)
            partial.update(leftHand: false, curl: 0.4, at: time)
            assert(partial.step(at: time, enabled: true) == .stop && partial.needsRelease,
                   "Partly curled hands must not satisfy the initial open-hand reset")
        }
        print("PASS: base/middle geometry, estimated-joint policy, rotation/scale invariance, two-finger agreement, noisy/missing finger stability, open-hand stop")
    }

    static func checkTrackingRecovery() {
        var brief = drivingInput()
        brief.update(leftHand: true, curl: nil, at: 0.36)
        brief.update(leftHand: false, curl: 0.9, at: 0.36)
        assert(brief.step(at: 0.36, enabled: true) == .stop,
               "One uncertain finger-bend stops both wheels immediately; never infer a turn")
        assert(!brief.needsRelease, "Brief finger-bend uncertainty must not latch the neutral reset")
        for time in [0.40, 0.50] {
            brief.update(leftHand: true, curl: 0.9, at: time)
            brief.update(leftHand: false, curl: 0.9, at: time)
            assert(brief.step(at: time, enabled: true) == .stop,
                   "Recovered tracking must settle before restarting")
        }
        brief.update(leftHand: true, curl: 0.9, at: 0.57)
        brief.update(leftHand: false, curl: 0.9, at: 0.57)
        assert(brief.step(at: 0.57, enabled: true) == .straight,
               "A short finger-bend dropout may recover after stable fresh samples")

        var prolonged = drivingInput()
        for time in [0.36, 0.45, 0.55, 0.60] {
            prolonged.update(leftHand: true, curl: nil, at: time)
            prolonged.update(leftHand: false, curl: 0.9, at: time)
            assert(prolonged.step(at: time, enabled: true) == .stop)
        }
        assert(prolonged.needsRelease, "Repeated invalid samples must not refresh the last-valid timestamp")
        for time in [0.61, 0.78] {
            prolonged.update(leftHand: true, curl: 0.9, at: time)
            prolonged.update(leftHand: false, curl: 0.9, at: time)
            assert(prolonged.step(at: time, enabled: true) == .stop && prolonged.needsRelease,
                   "Held fists cannot resume after sustained loss")
        }
        for time in [0.79, 0.96] {
            prolonged.update(leftHand: true, curl: 0.05, at: time)
            prolonged.update(leftHand: false, curl: 0.05, at: time)
            _ = prolonged.step(at: time, enabled: true)
        }
        assert(!prolonged.needsRelease, "Opening both hands must recover after sustained loss")

        var missedTicks = drivingInput()
        missedTicks.update(leftHand: true, curl: 0.9, at: 0.70)
        missedTicks.update(leftHand: false, curl: 0.9, at: 0.70)
        assert(missedTicks.step(at: 0.70, enabled: true) == .stop && missedTicks.needsRelease,
               "New samples must not hide a long gap when the evaluation loop was stalled")

        var lostHand = drivingInput()
        lostHand.update(leftHand: true, curl: nil, at: 0.36, handTracked: false)
        assert(lostHand.step(at: 0.36, enabled: true) == .stop && lostHand.needsRelease,
               "Explicit whole-hand loss still latches reset immediately")

        var interrupted = drivingInput()
        interrupted.update(leftHand: true, curl: nil, at: 0.36)
        assert(interrupted.step(at: 0.36, enabled: false) == .stop && interrupted.needsRelease,
               "Scene, panel, video and disable gates must override brief recovery")

        var corrupt = drivingInput()
        corrupt.update(leftHand: true, curl: .nan, at: 0.36)
        assert(corrupt.step(at: 0.36, enabled: true) == .stop && corrupt.needsRelease,
               "Corrupt numeric data is not a recoverable finger-bend dropout")

        var initial = HandMotionInput()
        initial.update(leftHand: true, curl: 0.05, at: 0)
        initial.update(leftHand: false, curl: 0.05, at: 0)
        _ = initial.step(at: 0, enabled: true)
        initial.update(leftHand: true, curl: nil, at: 0.1)
        _ = initial.step(at: 0.1, enabled: true)
        initial.update(leftHand: true, curl: 0.05, at: 0.16)
        initial.update(leftHand: false, curl: 0.05, at: 0.16)
        assert(initial.step(at: 0.16, enabled: true) == .stop && initial.needsRelease,
               "Uncertain samples cannot count toward the initial continuous open-hand reset")
        print("PASS: brief finger-bend recovery, stable restart, sustained loss, missed ticks, whole-hand loss, interrupted recovery, invalid data, continuous neutral reset")
    }
}
