import ARKit
import Foundation
import Observation
import simd

@MainActor @Observable
final class HandMotionController {
    private(set) var status = "Hand driving off"
    private(set) var leftTracked = false
    private(set) var rightTracked = false
    private(set) var leftFist = false
    private(set) var rightFist = false
    private(set) var leftTrackingIssue: String? = "Waiting for hand"
    private(set) var rightTrackingIssue: String? = "Waiting for hand"
    private(set) var leftGripDetail = "Waiting for finger data"
    private(set) var rightGripDetail = "Waiting for finger data"
    private(set) var leftPartlyCurled = false
    private(set) var rightPartlyCurled = false
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
                leftFist = false; rightFist = false; needsRelease = true
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
            print("[hands] Dual-bend recognizer · \(ProcessInfo.processInfo.operatingSystemVersionString) · estimated joints \(Self.allowEstimatedJoints ? "enabled" : "disabled")")
            var lastDiagnostic = ""
            var lastFingerLog: TimeInterval = -.infinity
            var leftFingerDiagnostic = "waiting"
            var rightFingerDiagnostic = "waiting"
            while !Task.isCancelled, runID == id, model.handDrivingEnabled {
                let now = ProcessInfo.processInfo.systemUptime
                // Reading latestAnchors while the provider is paused/stopped emits
                // ARKit errors. Clear stale input before waiting for it to resume.
                guard provider.state == .running else {
                    if isRunning { print("[hands] Provider paused or stopped") }
                    isRunning = false
                    leftTracked = false; rightTracked = false
                    leftFist = false; rightFist = false
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
                    let sample = gripSample(anchor)
                    input.update(leftHand: true, curl: sample.curl, at: now,
                                 handTracked: anchor.isTracked && anchor.handSkeleton != nil)
                    leftTrackingIssue = sample.issue
                    leftGripDetail = sample.detail
                    leftFingerDiagnostic = sample.diagnostic
                }
                if let anchor = anchors.rightHand {
                    let sample = gripSample(anchor)
                    input.update(leftHand: false, curl: sample.curl, at: now,
                                 handTracked: anchor.isTracked && anchor.handSkeleton != nil)
                    rightTrackingIssue = sample.issue
                    rightGripDetail = sample.detail
                    rightFingerDiagnostic = sample.diagnostic
                }
                let running = provider.state == .running
                leftTracked = running && input.isFresh(leftHand: true, at: now)
                rightTracked = running && input.isFresh(leftHand: false, at: now)
                if !leftTracked && leftTrackingIssue == nil { leftTrackingIssue = "No fresh sample" }
                if !rightTracked && rightTrackingIssue == nil { rightTrackingIssue = "No fresh sample" }
                leftFist = leftTracked && input.leftFist
                rightFist = rightTracked && input.rightFist
                leftPartlyCurled = leftTracked && !leftFist && (input.leftCurl ?? 0) > HandGripGeometry.openThreshold
                rightPartlyCurled = rightTracked && !rightFist && (input.rightCurl ?? 0) > HandGripGeometry.openThreshold
                let allowed = running && model.canDrive && !model.armed
                intent = input.step(at: now, enabled: allowed)
                needsRelease = input.needsRelease
                if !leftTracked || !rightTracked {
                    stopOwnedMotion(model)
                    // Tracking loss also invalidates a pending capsule arming.
                    model.halt()
                    status = needsRelease
                        ? "Tracking lost. Show both hands, then open both hands."
                        : "Finger bends uncertain · wheels stopped. Show both hands."
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
                    status = leftFist || rightFist
                        ? "Hold your fist steady…"
                        : "Ready · make a firm fist to drive"
                } else {
                    if ownedGesture == nil { ownedGesture = model.beginDrive() }
                    if let ownedGesture {
                        model.applyHandWheels(intent.wheels, gestureID: ownedGesture)
                        // A watchdog/stop can invalidate a gesture while a fist is held.
                        if model.driveGestureID != ownedGesture {
                            self.ownedGesture = nil
                            input.reset()
                        }
                    }
                    status = intent.rawValue
                }
                let diagnostic = "\(status) | left: \(leftTrackingIssue ?? (leftFist ? "fist" : "open")), right: \(rightTrackingIssue ?? (rightFist ? "fist" : "open"))"
                if diagnostic != lastDiagnostic {
                    print("[hands] \(diagnostic)")
                    lastDiagnostic = diagnostic
                }
                if now - lastFingerLog >= 1 {
                    print("[hands:data] left {\(leftFingerDiagnostic)} right {\(rightFingerDiagnostic)}")
                    lastFingerLog = now
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
        leftFist = false; rightFist = false; needsRelease = true
        leftTrackingIssue = "Tracking off"; rightTrackingIssue = "Tracking off"
        leftGripDetail = ""; rightGripDetail = ""
        leftPartlyCurled = false; rightPartlyCurled = false
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

    private static var allowEstimatedJoints: Bool {
        // visionOS 26 changed joint.isTracked sensitivity. Apple recommends
        // using the estimated transforms for gestures with occluded fingers:
        // https://developer.apple.com/documentation/visionos-release-notes/visionos-26-release-notes
        if #available(visionOS 26.0, *) { return true }
        return false
    }

    private func gripSample(_ hand: HandAnchor) -> (curl: Float?, issue: String?, detail: String, diagnostic: String) {
        guard hand.isTracked else { return (nil, "Hand not tracked", "", "hand untracked") }
        guard let skeleton = hand.handSkeleton else { return (nil, "No hand skeleton", "", "skeleton absent") }
        let fingers: [(HandSkeleton.JointName, HandSkeleton.JointName, HandSkeleton.JointName, HandSkeleton.JointName)] = [
            (.indexFingerMetacarpal, .indexFingerKnuckle, .indexFingerIntermediateBase, .indexFingerIntermediateTip),
            (.middleFingerMetacarpal, .middleFingerKnuckle, .middleFingerIntermediateBase, .middleFingerIntermediateTip),
            (.ringFingerMetacarpal, .ringFingerKnuckle, .ringFingerIntermediateBase, .ringFingerIntermediateTip)
        ]
        var diagnostics: [String] = []
        let bends = fingers.map { names -> HandGripGeometry.FingerBend? in
            let joints = [skeleton.joint(names.0), skeleton.joint(names.1), skeleton.joint(names.2), skeleton.joint(names.3)]
            let samples = joints.map { joint -> HandGripGeometry.Joint in
                let p = joint.anchorFromJointTransform.columns.3
                return .init(position: SIMD3(p.x, p.y, p.z), isTracked: joint.isTracked)
            }
            let bend = HandGripGeometry.measure(metacarpal: samples[0], knuckle: samples[1],
                                               intermediateBase: samples[2], intermediateTip: samples[3],
                                               allowEstimatedJoints: Self.allowEstimatedJoints)
            let estimated = joints.filter { !$0.isTracked }.map { String(describing: $0.name) }
            let value = bend.map { String(format: "base=%.2f middle=%.2f curl=%.2f", $0.base, $0.middle, $0.curl) }
                ?? "invalid geometry or unavailable joints"
            diagnostics.append("\(names.1): \(value), estimated=\(estimated.isEmpty ? "none" : estimated.joined(separator: ","))")
            return bend
        }
        let curls = bends.map { $0?.curl }
        let usable = bends.compactMap { $0 }.count
        let estimated = bends.compactMap { $0 }.filter(\.estimated).count
        let curl = HandGripGeometry.combinedCurl(curls)
        let base = HandGripGeometry.combinedCurl(bends.map { $0?.base })
        let middle = HandGripGeometry.combinedCurl(bends.map { $0?.middle })
        func percent(_ value: Float?) -> String { value.map { String(format: "%.0f%%", $0 * 100) } ?? "—" }
        let detail = "\(usable)/3 fingers · \(estimated) estimated\nbend \(percent(curl))\nbase \(percent(base)) · mid \(percent(middle))"
        let diagnostic = diagnostics.joined(separator: "; ")
        guard let curl else {
            return (nil, usable < 2 ? "Finger pose unavailable" : "Finger poses disagree", detail, diagnostic)
        }
        return (curl, nil, detail, diagnostic)
    }
}
