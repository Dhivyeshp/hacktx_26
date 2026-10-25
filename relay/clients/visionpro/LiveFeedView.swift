// Shows the Pi webcam stream. Needs RelayClient.swift in the same target.
//
//   @State private var relay = RelayClient(url: URL(string: "ws://<relay-ip>:8080/ws")!, token: "")
//   LiveFeedView(relay: relay)
import SwiftUI

struct LiveFeedView: View {
    var relay: RelayClient

    var body: some View {
        ZStack {
            if let frame = relay.latestFrame {
                Image(uiImage: frame)
                    .resizable()
                    .scaledToFit()
            } else {
                ProgressView(relay.isConnected ? "Waiting for video…" : "Connecting…")
            }
        }
        .frame(minWidth: 480, minHeight: 360)
        .onAppear { relay.connect() }
    }
}
