import SwiftUI

@main
struct CenterpieceApp: App {
    @State private var session = DemoSession()

    var body: some Scene {
        WindowGroup {
            DashboardView(session: session).preferredColorScheme(.dark)
        }
        .defaultSize(width: 1280, height: 800)
        .windowResizability(.contentSize)
    }
}
