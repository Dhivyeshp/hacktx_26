import Foundation
import CoreGraphics
import ImageIO

@main
struct RelayClientChecks {
    @MainActor static func waitUntil(_ condition: () -> Bool, timeout: Double = 10) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
        precondition(condition(), "Relay integration condition timed out")
    }
    static func jpeg() -> Data {
        let context = CGContext(data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 32,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        context.setFillColor(CGColor(red: 0.1, green: 0.8, blue: 0.4, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        let output = NSMutableData()
        let destination = CGImageDestinationCreateWithData(output, "public.jpeg" as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, nil)
        precondition(CGImageDestinationFinalize(destination))
        return output as Data
    }
    @MainActor static func main() async throws {
        let arguments = CommandLine.arguments
        let token = arguments.count > 3 ? arguments[3] : "fixture-token"
        // Exercise the same bundle loader used at launch, including an empty token.
        let bundleURL = FileManager.default.temporaryDirectory.appendingPathComponent("RelayChecks-\(UUID()).bundle")
        try FileManager.default.createDirectory(at: bundleURL, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: bundleURL) }
        let values = ["url": arguments[1], "token": token, "room": "table"]
        try PropertyListSerialization.data(fromPropertyList: values, format: .xml, options: 0)
            .write(to: bundleURL.appendingPathComponent("RelayConfig.plist"))
        let config = RelayConfiguration.bundled(bundle: Bundle(url: bundleURL)!)!
        precondition(config.url.absoluteString == arguments[1] && config.token == token)
        try jpeg().write(to: URL(fileURLWithPath: arguments[2]))
        precondition(RelayClient.decodeJPEG(Data([0xff, 0xd8, 0xff])) == nil)
        precondition(RelayClient.decodeJPEG(jpeg()) != nil)
        let request = config.request()
        precondition(request.value(forHTTPHeaderField: "Authorization") == (token.isEmpty ? nil : "Bearer \(token)"))
        precondition(!request.url!.absoluteString.contains("fixture-token"))
        let client = RelayClient(configuration: config)
        client.connect(); client.connect()
        try await waitUntil { client.isConnected && client.framesReceived == 1 }
        precondition(client.hasFreshFrame && client.latestFrame != nil && client.peers.contains("pi"))
        precondition(client.controlBlockReason == nil && client.canControlRobot)
        for (left, right): (Float, Float) in [(0, 0.35), (0.35, 0.35), (0.35, 0)] {
            client.sendDrive(left: left, right: right)
            try await waitUntil { client.motionStatus == "Wheel command sent" }
            client.stopRobot()
            try await waitUntil { client.motionStatus == "Stop sent" }
        }
        // Before the writer gets execution, many intents are superseded by stop.
        // The fixture must see no nonzero command from this canceled burst.
        for _ in 0..<1000 { client.sendDrive(left: 0.2, right: 0.2) }
        client.stopRobot()
        try await Task.sleep(for: .milliseconds(150))
        try await waitUntil { !client.hasFreshFrame && client.status.contains("paused") }
        // A connected relay with a silent Pi must say so, not look like a drop.
        precondition(client.controlBlockReason == "no Pi video in the last 3s" && !client.canControlRobot)
        try await waitUntil({ client.framesReceived >= 2 && client.hasFreshFrame }, timeout: 12)
        precondition(client.rejectedFrames >= 1)
        client.sendDrive(left: 0.35, right: 0.35)
        try await waitUntil { client.motionStatus == "Wheel command sent" }
        client.disconnect()
        let count = client.framesReceived
        try await Task.sleep(for: .seconds(3))
        precondition(!client.isConnected && !client.hasFreshFrame && client.latestFrame == nil)
        precondition(client.framesReceived == count && client.status == "Disconnected")
        precondition(client.controlBlockReason == "relay not connected")
        print("PASS: bundled configuration, optional auth, named control gates, room subscription, welcome, binary JPEG decode, malformed frame rejection, stale detection, reconnect, explicit disconnect")
    }
}
