import SwiftUI

@main
struct CenterpieceApp: App {
    var body: some Scene {
        WindowGroup {
            DashboardView()
                .preferredColorScheme(.dark)
        }
        .defaultSize(width: 1180, height: 800)
        .windowResizability(.contentSize)
    }
}
