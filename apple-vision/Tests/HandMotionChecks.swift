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
        // Poses are held across 50ms samples rather than asserted on single
        // frames, so the checks describe the gesture rather than one tuning of
        // the settle delay. `now` advances with the stream.
        var now = 0.0
        @discardableResult
        func hold(_ left: Float?, _ right: Float?, _ duration: Double) -> HandDriveIntent {
            let until = now + duration
            var last = HandDriveIntent.stop
            while now <= until + 0.0001 {
                update(now, left, right)
                last = input.step(at: now, enabled: true)
                now += 0.05
            }
            return last
        }
        let settle = HandMotionInput.settleDelay
        let brief = settle / 2

        update(0, 0.9, 0.9)
        assert(input.step(at: 0, enabled: true) == .stop && input.needsRelease)
        assert(hold(0.05, 0.05, 0.2) == .stop && !input.needsRelease)
        assert(hold(0.9, 0.9, brief) == .stop, "A fist must settle before the wheels move")
        assert(hold(0.9, 0.9, settle) == .straight)
        assert(input.intent.wheels == WheelCommand(left: 0.35, right: 0.35))
        assert(hold(0.9, 0.05, brief) == .stop)
        assert(hold(0.9, 0.05, settle) == .left)
        assert(input.intent.wheels == WheelCommand(left: 0, right: 0.35))
        assert(hold(0.4, 0.05, 0.05) == .left, "Hysteresis must reject fist jitter")
        assert(hold(0.05, 0.9, brief) == .stop)
        assert(hold(0.05, 0.9, settle) == .right)
        assert(input.intent.wheels == WheelCommand(left: 0.35, right: 0))
        assert(hold(0.05, 0.05, 0) == .stop, "Releasing both stops immediately")
        now += 0.3 // Longer than trackingTimeout, so the right hand goes stale.
        input.update(leftHand: true, curl: 0.9, at: now)
        assert(input.step(at: now, enabled: true) == .stop && input.needsRelease,
               "Missing right hand stops instead of turning")
        assert(hold(0.9, 0.9, settle) == .stop, "Reacquiring held fists cannot resume motion")
        hold(0.05, 0.05, 0.2)
        // A margin past the delay: it is counted from the first fist sample.
        assert(hold(0.9, 0.9, settle + 0.1) == .straight)
        assert(input.step(at: now, enabled: false) == .stop && input.needsRelease)
        update(now, nil, 0.9)
        assert(input.step(at: now, enabled: true) == .stop)
        update(now, .nan, 0.9)
        assert(!input.bothFresh(at: now))
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

    static func drivingInput() -> (input: HandMotionInput, now: TimeInterval) {
        var input = HandMotionInput()
        for time in [0.0, 0.16] {
            input.update(leftHand: true, curl: 0.05, at: time)
            input.update(leftHand: false, curl: 0.05, at: time)
            assert(input.step(at: time, enabled: true) == .stop)
        }
        // Sampled every 50ms, well inside trackingTimeout, so the hold reads as
        // a steady stream rather than a gap. The delay is counted from the
        // first fist sample, so hold a little past it rather than asserting a
        // particular frame.
        var time = 0.17
        let settled = 0.17 + HandMotionInput.settleDelay + 0.1
        var startedAt: TimeInterval?
        while time <= settled {
            input.update(leftHand: true, curl: 0.9, at: time)
            input.update(leftHand: false, curl: 0.9, at: time)
            if input.step(at: time, enabled: true) == .straight, startedAt == nil {
                startedAt = time
            }
            time += 0.05
        }
        assert(input.intent == .straight && !input.needsRelease)
        assert(startedAt.map { $0 - 0.17 >= HandMotionInput.settleDelay } == true,
               "A fist must be held for the full settle delay before the wheels move")
        return (input, time)
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

        var (occluded, oNow) = drivingInput()
        for i in 1...20 {
            let time = oNow + Double(i) * 0.03
            let score = HandGripGeometry.combinedCurl([estimated.curl, estimated.curl, nil])
            occluded.update(leftHand: true, curl: score, at: time)
            occluded.update(leftHand: false, curl: score, at: time)
            assert(occluded.step(at: time, enabled: true) == .straight)
        }
        let lost = oNow + 21 * 0.03
        occluded.update(leftHand: true, curl: estimated.curl, at: lost, handTracked: false)
        assert(occluded.step(at: lost, enabled: true) == .stop && occluded.needsRelease,
               "Estimated finger poses cannot override whole-hand loss")
        assert(occluded.step(at: lost + 0.35, enabled: true) == .stop,
               "Estimated finger poses cannot override stale samples")
        assert(HandGripGeometry.combinedCurl([1, 1, nil]) == 1, "Two fingers can recognize a fist without the third")
        assert(HandGripGeometry.combinedCurl([0, 0, 1]) == 0, "One bent finger must not look like a fist")
        assert(HandGripGeometry.combinedCurl([1, 1, 0]) == 1, "One outlier must not break a held fist")
        assert(HandGripGeometry.combinedCurl([0, 1, nil]) == nil, "Two conflicting fingers provide no decision")
        assert(HandGripGeometry.combinedCurl([1, nil, nil]) == nil, "One finger is insufficient")
        // Expressed against the thresholds, so retuning the recognizer does
        // not silently turn these into tests of something else.
        let fistLimit = HandGripGeometry.fistThreshold
        let openLimit = HandGripGeometry.openThreshold
        let barelyClosed = fistLimit + 0.01
        let barelyOpen = openLimit - 0.01
        let ambiguous = (openLimit + fistLimit) / 2
        assert(HandGripGeometry.combinedCurl([barelyClosed, 1, nil]) == barelyClosed,
               "Two closed fingers must agree even when their bend amounts differ widely")
        assert(HandGripGeometry.combinedCurl([0, barelyOpen, nil]) == barelyOpen)
        assert(HandGripGeometry.combinedCurl([ambiguous, barelyClosed, nil]) == nil,
               "Do not average an ambiguous and closed finger into a new fist")

        var (input, start) = drivingInput()
        for i in 1...50 {
            let time = start + Double(i) * 0.03
            let curl = HandGripGeometry.combinedCurl(i.isMultiple(of: 2) ? [barelyClosed, nil, 1] : [0.9, 0.9, 0])
            input.update(leftHand: true, curl: curl, at: time)
            input.update(leftHand: false, curl: curl, at: time)
            assert(input.step(at: time, enabled: true) == .straight,
                   "One missing/noisy finger must not produce repeated drive/stop bursts")
        }
        let afterBurst = start + 51 * 0.03
        input.update(leftHand: true, curl: openScore, at: afterBurst)
        input.update(leftHand: false, curl: openScore, at: afterBurst)
        assert(input.step(at: afterBurst, enabled: true) == .stop, "Opening hands must stop immediately")

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
        var (brief, briefNow) = drivingInput()
        brief.update(leftHand: true, curl: nil, at: briefNow)
        brief.update(leftHand: false, curl: 0.9, at: briefNow)
        assert(brief.step(at: briefNow, enabled: true) == .stop,
               "One uncertain finger-bend stops both wheels immediately; never infer a turn")
        assert(!brief.needsRelease, "Brief finger-bend uncertainty must not latch the neutral reset")
        let resumed = briefNow + 0.05
        var recovered: TimeInterval?
        var at = resumed
        while at <= resumed + HandMotionInput.settleDelay + 0.1 {
            brief.update(leftHand: true, curl: 0.9, at: at)
            brief.update(leftHand: false, curl: 0.9, at: at)
            if brief.step(at: at, enabled: true) == .straight, recovered == nil { recovered = at }
            at += 0.05
        }
        assert(recovered.map { $0 - resumed >= HandMotionInput.settleDelay } == true,
               "A short finger-bend dropout may recover, but only after the settle delay")

        var (prolonged, pNow) = drivingInput()
        for time in [pNow, pNow + 0.09, pNow + 0.19, pNow + 0.24] {
            prolonged.update(leftHand: true, curl: nil, at: time)
            prolonged.update(leftHand: false, curl: 0.9, at: time)
            assert(prolonged.step(at: time, enabled: true) == .stop)
        }
        assert(prolonged.needsRelease, "Repeated invalid samples must not refresh the last-valid timestamp")
        for time in [pNow + 0.25, pNow + 0.42] {
            prolonged.update(leftHand: true, curl: 0.9, at: time)
            prolonged.update(leftHand: false, curl: 0.9, at: time)
            assert(prolonged.step(at: time, enabled: true) == .stop && prolonged.needsRelease,
                   "Held fists cannot resume after sustained loss")
        }
        for time in [pNow + 0.43, pNow + 0.60] {
            prolonged.update(leftHand: true, curl: 0.05, at: time)
            prolonged.update(leftHand: false, curl: 0.05, at: time)
            _ = prolonged.step(at: time, enabled: true)
        }
        assert(!prolonged.needsRelease, "Opening both hands must recover after sustained loss")

        var (missedTicks, mNow) = drivingInput()
        let stalled = mNow + 0.3 // Longer than trackingTimeout.
        missedTicks.update(leftHand: true, curl: 0.9, at: stalled)
        missedTicks.update(leftHand: false, curl: 0.9, at: stalled)
        assert(missedTicks.step(at: stalled, enabled: true) == .stop && missedTicks.needsRelease,
               "New samples must not hide a long gap when the evaluation loop was stalled")

        var (lostHand, lostHandNow) = drivingInput()
        lostHand.update(leftHand: true, curl: nil, at: lostHandNow, handTracked: false)
        assert(lostHand.step(at: lostHandNow, enabled: true) == .stop && lostHand.needsRelease,
               "Explicit whole-hand loss still latches reset immediately")

        var (interrupted, interruptedNow) = drivingInput()
        interrupted.update(leftHand: true, curl: nil, at: interruptedNow)
        assert(interrupted.step(at: interruptedNow, enabled: false) == .stop && interrupted.needsRelease,
               "Scene, panel, video and disable gates must override brief recovery")

        var (corrupt, corruptNow) = drivingInput()
        corrupt.update(leftHand: true, curl: .nan, at: corruptNow)
        assert(corrupt.step(at: corruptNow, enabled: true) == .stop && corrupt.needsRelease,
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
