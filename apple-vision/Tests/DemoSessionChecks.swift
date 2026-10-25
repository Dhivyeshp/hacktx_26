import Foundation
import CoreGraphics

@main
struct DemoSessionChecks {
    @MainActor static func prepared() -> DemoSession {
        let model = DemoSession()
        model.selectPlayer(Player.samples[0])
        model.selectQuestion(0)
        model.enterDriving()
        return model
    }

    @MainActor static func main() async throws {
        let empty = DemoSession()
        empty.enterDriving(); empty.arm(); empty.drop()
        assert(!empty.isDriving && !empty.canDrop && empty.events.isEmpty)
        empty.selectPlayer(Player.samples[0]); empty.selectQuestion(0)
        empty.selectPlayer(Player.samples[1])
        assert(empty.selection == nil, "Changing player must clear question")

        let movement = prepared()
        movement.arm(); assert(movement.canDrop)
        movement.beginDrive()
        movement.move(forward: 1, turn: 0.5)
        assert(!movement.armed && !movement.canDrop)
        movement.drop(); assert(movement.events.isEmpty)
        try await Task.sleep(for: .milliseconds(300))
        movement.tick(); assert(!movement.isMoving, "Input watchdog must stop stale movement")
        movement.emergencyStop(); movement.move(forward: 1, turn: 0)
        assert(!movement.isMoving && !movement.canArm, "Stop must remain latched")

        let input = prepared()
        assert(DriveInput(translation: .zero).forward == 0 && DriveInput(translation: .zero).turn == 0)
        assert(DriveInput(translation: CGSize(width: 3, height: -3)).forward == 0)
        assert(DriveInput(translation: CGSize(width: 0, height: -56)).forward == 1)
        assert(DriveInput(translation: CGSize(width: 0, height: 56)).forward == 0)
        assert(DriveInput(translation: CGSize(width: -56, height: 0)).turn == -1)
        let diagonal = DriveInput(translation: CGSize(width: 500, height: -500))
        assert(hypot(diagonal.offset.width, diagonal.offset.height) <= DriveInput.radius + 0.001)
        let wheels = WheelCommand(forward: 1, turn: 1)
        assert(wheels.left == 0.6 && wheels.right == 0)
        assert(DriveInput(translation: CGSize(width: CGFloat.infinity, height: 0)) == .zero)
        input.arm()
        let previousArming = input.armingID!
        let previousGesture = input.beginDrive()!
        input.updateDrive(diagonal, gestureID: previousGesture)
        assert(!input.canArm && !input.canDrop && !input.armed, "Driving disarms even while holding the puck centered")
        input.endDrive(gestureID: previousGesture)
        assert(!input.isMoving && !input.driveGestureActive)
        let currentGesture = input.beginDrive()!
        input.endDrive(gestureID: previousGesture)
        input.updateDrive(.zero, gestureID: previousGesture)
        assert(input.driveGestureID == currentGesture, "A canceled task must not stop a new gesture")
        input.endDrive(gestureID: currentGesture)
        input.arm()
        input.drop(armedWith: previousArming)
        assert(input.events.isEmpty && input.phase == .ready, "An old hold must not dispense after rearming")
        input.controlsSuspended = true; input.halt()
        assert(input.beginDrive() == nil && !input.canDrop)
        input.controlsSuspended = false
        input.arm(); input.cameraAvailable = false; input.cameraChanged()
        assert(!input.canDrop && !input.armed && input.beginDrive() == nil)

        let failure = prepared()
        failure.failure = .questionUpdate
        failure.arm(); failure.drop()
        try await Task.sleep(for: .milliseconds(1200))
        assert(failure.phase == .failed && failure.activeQuestion == nil)
        assert(!failure.events.contains("Dispense requested"))

        let canceled = prepared()
        canceled.arm(); canceled.drop(); canceled.emergencyStop()
        try await Task.sleep(for: .milliseconds(1200))
        assert(canceled.activeQuestion == nil && canceled.phase == .stopped)
        assert(!canceled.events.contains("Dispense requested"))

        let success = prepared()
        success.arm(); success.drop(); success.drop()
        assert(success.events.count == 1, "Duplicate drops must be ignored")
        try await Task.sleep(for: .milliseconds(1200))
        assert(success.phase == .dispensing && success.activeQuestion?.playerName == "Maya")
        assert(success.events[1].contains("Shared URL updated") && success.events[2] == "Dispense requested")
        success.selectPlayer(Player.samples[1]); assert(success.selectedPlayerID == 0)
        try await Task.sleep(for: .milliseconds(1200))
        assert(success.phase == .delivered && !success.canDrop)
        assert(success.events.filter { $0.contains("One capsule dispensed") }.count == 1)
        success.finishRound()
        assert(success.activeQuestion?.playerName == "Maya", "Shared page retains latest question")
        success.selectPlayer(Player.samples[1]); success.selectQuestion(1)
        success.enterDriving(); success.failure = .dispenser; success.arm(); success.drop()
        try await Task.sleep(for: .milliseconds(2400))
        assert(success.phase == .failed && success.activeQuestion?.playerName == "Jordan")
        assert(success.roundInProgress && !success.canDrop)
        print("PASS: selection, movement interlocks, watchdog, latched stop, gesture release/cancellation, old gesture isolation, video loss, URL failure, cancellation, ordering, duplicate drop, shared-page persistence, dispenser failure")
    }
}
