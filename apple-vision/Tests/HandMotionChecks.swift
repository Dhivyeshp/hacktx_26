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
}
