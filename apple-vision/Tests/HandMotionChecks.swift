import Foundation
import CoreGraphics

@main
struct HandMotionChecks {
    @MainActor static func main() {
        var input = HandMotionInput()
        func update(_ time: Double, _ left: Float?, _ right: Float?) {
            input.update(leftHand: true, distance: left, at: time)
            input.update(leftHand: false, distance: right, at: time)
        }
        update(0, 0.01, 0.01)
        assert(input.step(at: 0, enabled: true) == .stop && input.needsRelease)
        update(0.1, 0.06, 0.06)
        assert(input.step(at: 0.1, enabled: true) == .stop)
        update(0.3, 0.06, 0.06)
        assert(input.step(at: 0.3, enabled: true) == .stop && !input.needsRelease)
        update(0.31, 0.01, 0.01)
        assert(input.step(at: 0.31, enabled: true) == .stop)
        update(0.5, 0.01, 0.01)
        assert(input.step(at: 0.5, enabled: true) == .straight)
        assert(input.intent.wheels == WheelCommand(left: 0.35, right: 0.35))
        update(0.51, 0.01, 0.06)
        assert(input.step(at: 0.51, enabled: true) == .stop)
        update(0.7, 0.01, 0.06)
        assert(input.step(at: 0.7, enabled: true) == .left)
        assert(input.intent.wheels == WheelCommand(left: 0, right: 0.35))
        update(0.71, 0.028, 0.06)
        assert(input.step(at: 0.71, enabled: true) == .left, "Hysteresis must reject pinch jitter")
        update(0.72, 0.06, 0.01)
        assert(input.step(at: 0.72, enabled: true) == .stop)
        update(0.9, 0.06, 0.01)
        assert(input.step(at: 0.9, enabled: true) == .right)
        assert(input.intent.wheels == WheelCommand(left: 0.35, right: 0))
        update(0.91, 0.06, 0.06)
        assert(input.step(at: 0.91, enabled: true) == .stop, "Releasing both stops immediately")
        input.update(leftHand: true, distance: 0.01, at: 1.2)
        assert(input.step(at: 1.2, enabled: true) == .stop && input.needsRelease, "Missing right hand stops instead of turning")
        update(1.21, 0.01, 0.01)
        assert(input.step(at: 1.21, enabled: true) == .stop, "Reacquiring held pinches cannot resume motion")
        update(1.3, 0.06, 0.06); _ = input.step(at: 1.3, enabled: true)
        update(1.5, 0.06, 0.06); _ = input.step(at: 1.5, enabled: true)
        update(1.51, 0.01, 0.01); _ = input.step(at: 1.51, enabled: true)
        update(1.7, 0.01, 0.01)
        assert(input.step(at: 1.7, enabled: true) == .straight)
        assert(input.step(at: 1.7, enabled: false) == .stop && input.needsRelease)
        update(1.71, nil, 0.01)
        assert(input.step(at: 1.71, enabled: true) == .stop)
        update(1.8, .nan, 0.01)
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
        print("PASS: straight/left/right wheel mapping, neutral reset, stable starts, release stop, pinch hysteresis, missing/stale hands, interruption, invalid samples")
    }

    static func drivingInput() -> HandMotionInput {
        var input = HandMotionInput()
        for time in [0.0, 0.16] {
            input.update(leftHand: true, distance: 0.06, at: time)
            input.update(leftHand: false, distance: 0.06, at: time)
            assert(input.step(at: time, enabled: true) == .stop)
        }
        for time in [0.17, 0.34] {
            input.update(leftHand: true, distance: 0.01, at: time)
            input.update(leftHand: false, distance: 0.01, at: time)
            _ = input.step(at: time, enabled: true)
        }
        assert(input.intent == .straight && !input.needsRelease)
        return input
    }

    static func checkTrackingRecovery() {
        var brief = drivingInput()
        brief.update(leftHand: true, distance: nil, at: 0.36)
        brief.update(leftHand: false, distance: 0.01, at: 0.36)
        assert(brief.step(at: 0.36, enabled: true) == .stop,
               "One uncertain fingertip stops both wheels immediately; never infer a turn")
        assert(!brief.needsRelease, "Brief fingertip uncertainty must not latch the neutral reset")
        for time in [0.40, 0.50] {
            brief.update(leftHand: true, distance: 0.01, at: time)
            brief.update(leftHand: false, distance: 0.01, at: time)
            assert(brief.step(at: time, enabled: true) == .stop,
                   "Recovered tracking must settle before restarting")
        }
        brief.update(leftHand: true, distance: 0.01, at: 0.57)
        brief.update(leftHand: false, distance: 0.01, at: 0.57)
        assert(brief.step(at: 0.57, enabled: true) == .straight,
               "A short fingertip dropout may recover after stable fresh samples")

        var prolonged = drivingInput()
        for time in [0.36, 0.45, 0.55, 0.60] {
            prolonged.update(leftHand: true, distance: nil, at: time)
            prolonged.update(leftHand: false, distance: 0.01, at: time)
            assert(prolonged.step(at: time, enabled: true) == .stop)
        }
        assert(prolonged.needsRelease, "Repeated invalid samples must not refresh the last-valid timestamp")
        for time in [0.61, 0.78] {
            prolonged.update(leftHand: true, distance: 0.01, at: time)
            prolonged.update(leftHand: false, distance: 0.01, at: time)
            assert(prolonged.step(at: time, enabled: true) == .stop && prolonged.needsRelease,
                   "Held pinches cannot resume after sustained loss")
        }
        for time in [0.79, 0.96] {
            prolonged.update(leftHand: true, distance: 0.06, at: time)
            prolonged.update(leftHand: false, distance: 0.06, at: time)
            _ = prolonged.step(at: time, enabled: true)
        }
        assert(!prolonged.needsRelease, "Opening both hands must recover after sustained loss")

        var missedTicks = drivingInput()
        missedTicks.update(leftHand: true, distance: 0.01, at: 0.70)
        missedTicks.update(leftHand: false, distance: 0.01, at: 0.70)
        assert(missedTicks.step(at: 0.70, enabled: true) == .stop && missedTicks.needsRelease,
               "New samples must not hide a long gap when the evaluation loop was stalled")

        var lostHand = drivingInput()
        lostHand.update(leftHand: true, distance: nil, at: 0.36, handTracked: false)
        assert(lostHand.step(at: 0.36, enabled: true) == .stop && lostHand.needsRelease,
               "Explicit whole-hand loss still latches reset immediately")

        var interrupted = drivingInput()
        interrupted.update(leftHand: true, distance: nil, at: 0.36)
        assert(interrupted.step(at: 0.36, enabled: false) == .stop && interrupted.needsRelease,
               "Scene, panel, video and disable gates must override brief recovery")

        var corrupt = drivingInput()
        corrupt.update(leftHand: true, distance: .nan, at: 0.36)
        assert(corrupt.step(at: 0.36, enabled: true) == .stop && corrupt.needsRelease,
               "Corrupt numeric data is not a recoverable fingertip dropout")

        var initial = HandMotionInput()
        initial.update(leftHand: true, distance: 0.06, at: 0)
        initial.update(leftHand: false, distance: 0.06, at: 0)
        _ = initial.step(at: 0, enabled: true)
        initial.update(leftHand: true, distance: nil, at: 0.1)
        _ = initial.step(at: 0.1, enabled: true)
        initial.update(leftHand: true, distance: 0.06, at: 0.16)
        initial.update(leftHand: false, distance: 0.06, at: 0.16)
        assert(initial.step(at: 0.16, enabled: true) == .stop && initial.needsRelease,
               "Uncertain samples cannot count toward the initial continuous open-hand reset")
        print("PASS: brief fingertip recovery, stable restart, sustained loss, missed ticks, whole-hand loss, interrupted recovery, invalid data, continuous neutral reset")
    }
}
