import ARKit
import Foundation
import Observation
import simd

@MainActor @Observable
final class HandMotionController {
    private(set) var status = "Hand driving off"
    private(set) var leftTracked = false
    private(set) var rightTracked = false
    private(set) var leftPinched = false
    private(set) var rightPinched = false
    private(set) var leftTrackingIssue: String? = "Waiting for hand"
    private(set) var rightTrackingIssue: String? = "Waiting for hand"
    private(set) var needsRelease = true
    private(set) var intent: HandDriveIntent = .stop
    private(set) var isRunning = false
    private(set) var isRequestingPermission = false
    private var arSession: ARKitSession?
    private var input = HandMotionInput()
    private var ownedGesture: UUID?
    private var runID = UUID()

    func run(model: DemoSession) async {
        guard !Task.isCancelled, model.handDrivingEnabled else { return }
        let id = UUID()
        runID = id
        guard HandTrackingProvider.isSupported else {
            status = "ARKit hands require a physical Vision Pro."
            return
        }
        let arSession = ARKitSession()
        let provider = HandTrackingProvider()
        self.arSession = arSession
        input = HandMotionInput()
        status = "Allow hand tracking on the headset…"
        isRequestingPermission = true
        defer {
            arSession.stop()
            if runID == id {
                self.arSession = nil
                stopOwnedMotion(model)
                isRunning = false
                isRequestingPermission = false
                leftTracked = false; rightTracked = false
                leftPinched = false; rightPinched = false; needsRelease = true
            }
        }
        let authorization = await arSession.requestAuthorization(for: [.handTracking])
        if runID == id { isRequestingPermission = false }
        guard !Task.isCancelled, runID == id, model.handDrivingEnabled else { return }
        guard authorization[.handTracking] == .allowed else {
            status = "Hand tracking permission is off. Enable it in Privacy & Security."
            return
        }
        do {
            try await arSession.run([provider])
            isRunning = true
            var lastDiagnostic = ""
            while !Task.isCancelled, runID == id, model.handDrivingEnabled {
                let now = ProcessInfo.processInfo.systemUptime
                // Reading latestAnchors while the provider is paused/stopped emits
                // ARKit errors. Clear stale input before waiting for it to resume.
                guard provider.state == .running else {
                    if isRunning { print("[hands] Provider paused or stopped") }
                    isRunning = false
                    leftTracked = false; rightTracked = false
                    leftPinched = false; rightPinched = false
                    leftTrackingIssue = "Tracking paused"; rightTrackingIssue = "Tracking paused"
                    input = HandMotionInput(); needsRelease = true
                    stopOwnedMotion(model)
                    model.halt()
                    status = "Hand tracking paused. Keep the immersive view active."
                    try await Task.sleep(for: .milliseconds(30))
                    continue
                }
                if !isRunning { print("[hands] Provider running again; open both hands") }
                isRunning = true
                let anchors = provider.latestAnchors
                if let anchor = anchors.leftHand {
                    let sample = pinchSample(anchor)
                    input.update(leftHand: true, distance: sample.distance, at: now,
                                 handTracked: anchor.isTracked && anchor.handSkeleton != nil)
                    leftTrackingIssue = sample.issue
                }
                if let anchor = anchors.rightHand {
                    let sample = pinchSample(anchor)
                    input.update(leftHand: false, distance: sample.distance, at: now,
                                 handTracked: anchor.isTracked && anchor.handSkeleton != nil)
                    rightTrackingIssue = sample.issue
                }
                let running = provider.state == .running
                leftTracked = running && input.isFresh(leftHand: true, at: now)
                rightTracked = running && input.isFresh(leftHand: false, at: now)
                if !leftTracked && leftTrackingIssue == nil { leftTrackingIssue = "No fresh sample" }
                if !rightTracked && rightTrackingIssue == nil { rightTrackingIssue = "No fresh sample" }
                leftPinched = leftTracked && input.leftPinched
                rightPinched = rightTracked && input.rightPinched
                let allowed = running && model.canDrive && !model.armed
                intent = input.step(at: now, enabled: allowed)
                needsRelease = input.needsRelease
                if !leftTracked || !rightTracked {
                    stopOwnedMotion(model)
                    // Tracking loss also invalidates a pending capsule arming.
                    model.halt()
                    status = needsRelease
                        ? "Tracking lost. Show both hands, then open both pinches."
                        : "Fingertips uncertain · wheels stopped. Hold both hands in view."
                } else if !model.sceneActive {
                    stopOwnedMotion(model)
                    status = "Hand driving paused while the app is inactive."
                } else if model.controlsSuspended {
                    stopOwnedMotion(model)
                    status = "Hand driving paused while a panel is open."
                } else if model.armed {
                    stopOwnedMotion(model)
                    status = "Drop armed · driving paused"
                } else if let reason = model.driveBlockReason {
                    stopOwnedMotion(model)
                    status = "Wheels paused · \(reason)"
                } else if needsRelease {
                    stopOwnedMotion(model)
                    status = "Open both hands to get ready."
                } else if intent == .stop {
                    stopOwnedMotion(model)
                    status = leftPinched || rightPinched
                        ? "Hold pinch steady…"
                        : "Ready · thumb to middle finger to drive"
                } else {
                    if ownedGesture == nil { ownedGesture = model.beginDrive() }
                    if let ownedGesture {
                        model.applyHandWheels(intent.wheels, gestureID: ownedGesture)
                        // A watchdog/stop can invalidate a gesture while a pinch is held.
                        if model.driveGestureID != ownedGesture {
                            self.ownedGesture = nil
                            input.reset()
                        }
                    }
                    status = intent.rawValue
                }
                let diagnostic = "\(status) | left: \(leftTrackingIssue ?? (leftPinched ? "pinched" : "open")), right: \(rightTrackingIssue ?? (rightPinched ? "pinched" : "open"))"
                if diagnostic != lastDiagnostic {
                    print("[hands] \(diagnostic)")
                    lastDiagnostic = diagnostic
                }
                try await Task.sleep(for: .milliseconds(30))
            }
            if runID == id { status = "Hand driving off" }
        } catch {
            if runID == id, !Task.isCancelled { status = "Hand tracking unavailable. Disable and retry." }
        }
    }

    func requireNeutralReset(model: DemoSession) {
        input.reset()
        needsRelease = true
        stopOwnedMotion(model)
        model.halt()
        status = "Paused. Return to the app and open both hands."
    }

    func stop(model: DemoSession) {
        runID = UUID()
        arSession?.stop()
        arSession = nil
        isRunning = false
        isRequestingPermission = false
        leftTracked = false; rightTracked = false
        leftPinched = false; rightPinched = false; needsRelease = true
        leftTrackingIssue = "Tracking off"; rightTrackingIssue = "Tracking off"
        stopOwnedMotion(model)
        input.reset()
        intent = .stop
        status = "Hand driving off"
    }

    private func stopOwnedMotion(_ model: DemoSession) {
        if let ownedGesture { model.endDrive(gestureID: ownedGesture) }
        ownedGesture = nil
        intent = .stop
    }

    private func pinchSample(_ hand: HandAnchor) -> (distance: Float?, issue: String?) {
        guard hand.isTracked else { return (nil, "Hand not tracked") }
        guard let skeleton = hand.handSkeleton else { return (nil, "No hand skeleton") }
        let thumb = skeleton.joint(.thumbTip)
        let middle = skeleton.joint(.middleFingerTip)
        guard thumb.isTracked else { return (nil, "Thumb tip uncertain") }
        guard middle.isTracked else { return (nil, "Middle tip uncertain") }
        let a = thumb.anchorFromJointTransform.columns.3
        let b = middle.anchorFromJointTransform.columns.3
        let distance = simd_distance(SIMD3(a.x, a.y, a.z), SIMD3(b.x, b.y, b.z))
        // Pass invalid values through so the input model latches a full reset.
        return (distance, distance.isFinite ? nil : "Invalid finger position")
    }
}
