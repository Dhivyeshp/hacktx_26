import SwiftUI

/// "Everyone here". Real joined players, their interest readiness and how many
/// turns each has taken, which is what the recommender balances on.
struct RosterPanel: View {
    let feed: GameMasterFeed?
    let targetPlayerID: String
    let rewards: RewardsFeed?

    private var players: [FeedPlayer] { feed?.players ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("Everyone here")
                Text("\(players.count) of 6 joined")
                    .font(Destina.heading(26))
                    .foregroundStyle(Destina.text)
                Text(readiness)
                    .font(Destina.ui(12))
                    .foregroundStyle(Destina.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Rectangle().fill(Destina.line).frame(height: 1)
            if players.isEmpty {
                Text("No one has joined yet. Players open the room on their phones.")
                    .font(Destina.ui(12))
                    .foregroundStyle(Destina.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ScrollView {
                    VStack(spacing: 12) {
                        ForEach(players) { player in row(player) }
                    }
                }
                .frame(maxHeight: 420)
            }
        }
        .frame(width: 290, alignment: .leading)
        .destinaPanel()
    }

    private var readiness: String {
        guard let feed else { return "Waiting for your room." }
        if feed.room.playerCount == 0 { return "Waiting for the first player." }
        return feed.room.readyCount == feed.room.playerCount
            ? "Everyone has saved their interests."
            : "\(feed.room.readyCount) of \(feed.room.playerCount) have saved interests."
    }

    private func row(_ player: FeedPlayer) -> some View {
        let isTarget = player.id == targetPlayerID
        let tokens = rewards?.players.first { $0.playerId == player.id }
        return HStack(spacing: 12) {
            Text(player.initial)
                .font(Destina.heading(19))
                .foregroundStyle(Destina.ink)
                .frame(width: 38, height: 38)
                .background(Circle().fill(isTarget ? Destina.tan : Destina.cream2))
            VStack(alignment: .leading, spacing: 3) {
                Text(player.name)
                    .font(Destina.ui(14, weight: .medium))
                    .foregroundStyle(Destina.text)
                HStack(spacing: 7) {
                    StatusDot(ok: player.ready)
                    Text(player.ready ? "Interests saved" : "Adding interests")
                        .font(Destina.ui(11))
                        .foregroundStyle(Destina.textMuted)
                }
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 3) {
                Text("\(player.participation) turns")
                    .font(Destina.ui(11).monospacedDigit())
                    .foregroundStyle(Destina.textMuted)
                if let tokens, tokens.approved > 0 {
                    Text("\(tokens.approved) tokens")
                        .font(Destina.ui(10).monospacedDigit())
                        .foregroundStyle(Destina.tan)
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .background(isTarget ? Destina.tan.opacity(0.12) : Color.clear)
        .overlay(
            Rectangle().stroke(isTarget ? Destina.tan : Destina.line, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(player.name), \(player.ready ? "interests saved" : "adding interests"), \(player.participation) turns"
        )
        .accessibilityAddTraits(isTarget ? [.isSelected] : [])
    }
}
