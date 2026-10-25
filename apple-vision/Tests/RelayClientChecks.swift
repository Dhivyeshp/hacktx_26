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
        try jpeg().write(to: URL(fileURLWithPath: arguments[2]))
        precondition(RelayClient.decodeJPEG(Data([0xff, 0xd8, 0xff])) == nil)
        precondition(RelayClient.decodeJPEG(jpeg()) != nil)
        let config = RelayConfiguration(url: URL(string: arguments[1])!, token: "fixture-token", room: "table")
        let request = config.request()
        precondition(request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-token")
        precondition(!request.url!.absoluteString.contains("fixture-token"))
        let client = RelayClient(configuration: config)
        client.connect(); client.connect()
        try await waitUntil { client.isConnected && client.framesReceived == 1 }
        precondition(client.hasFreshFrame && client.latestFrame != nil && client.peers.contains("pi"))
        try await waitUntil { !client.hasFreshFrame && client.status.contains("paused") }
        try await waitUntil({ client.framesReceived >= 2 && client.hasFreshFrame }, timeout: 12)
        precondition(client.rejectedFrames >= 1)
        client.disconnect()
        let count = client.framesReceived
        try await Task.sleep(for: .seconds(3))
        precondition(!client.isConnected && !client.hasFreshFrame && client.latestFrame == nil)
        precondition(client.framesReceived == count && client.status == "Disconnected")
        print("PASS: bearer auth, room subscription, welcome, binary JPEG decode, malformed frame rejection, stale detection, reconnect, explicit disconnect")
    }
}
