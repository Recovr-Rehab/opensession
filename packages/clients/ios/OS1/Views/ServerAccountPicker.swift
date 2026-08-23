import SwiftUI

/// Organization switcher shared by the iPhone toolbar and Mac sidebar.
struct ServerAccountPicker: View {
    var iconSize: CGFloat = 32
    var compact = false
    let openSettings: () -> Void

    @State private var config = ServerConfig.shared
    @State private var presence = PresenceStore.shared

    var body: some View {
        Menu {
            Section("Organizations") {
                ForEach(config.accounts) { account in
                    Button {
                        guard account.id != config.activeId else { return }
                        GitHubSignIn.shared.cancel()
                        config.activate(account.id)
                        PresenceStore.shared.start()
                    } label: {
                        HStack {
                            Label(
                                account.displayLabel,
                                systemImage: account.id == config.activeId
                                    ? "checkmark.circle.fill"
                                    : "circle"
                            )
                            if let count = config.accountBadges[account.id], count > 0 {
                                Text("\(count)")
                            }
                        }
                    }
                }
            }

            Button {
                GitHubSignIn.shared.cancel()
                config.addAccount()
                openSettings()
            } label: {
                Label("Add organization", systemImage: "plus")
            }

            Button(action: openSettings) {
                Label("Settings", systemImage: "gearshape")
            }
        } label: {
            HStack(spacing: compact ? 6 : 8) {
                OrganizationAppIcon(size: iconSize, fallbackScale: 0.88)
                    .overlay(alignment: .topTrailing) {
                        if inactiveBadgeCount > 0 {
                            Circle()
                                .fill(.red)
                                .frame(width: 9, height: 9)
                                .overlay(Circle().stroke(OS1VisualStyle.background, lineWidth: 1.5))
                        }
                    }
                    .overlay(alignment: .bottomTrailing) {
                        Circle()
                            .fill(isConnected ? OS1VisualStyle.green : OS1VisualStyle.textFaint)
                            .frame(width: 9, height: 9)
                            .overlay(
                                Circle().stroke(OS1VisualStyle.background, lineWidth: 1.5)
                            )
                    }
                if !compact {
                    Text(config.activeAccount.displayLabel)
                        .font(.headline)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .accessibilityLabel("Organization, \(config.activeAccount.displayLabel)")
        .accessibilityValue(isConnected ? "Connected" : "Connecting")
        .accessibilityHint("Switch organization or open settings")
    }

    private var isConnected: Bool {
        presence.isConnected(accountID: config.activeId)
    }

    private var inactiveBadgeCount: Int {
        config.accountBadges.reduce(into: 0) { total, item in
            if item.key != config.activeId { total += item.value }
        }
    }
}
