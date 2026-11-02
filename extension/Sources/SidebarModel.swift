import CmuxExtensionKit
import SwiftUI

/// What the cmux sidebar shows: the workspace snapshot from cmux plus Tama's state (PetModel).
@MainActor
final class SidebarModel: PetModel {
    @Published private(set) var snapshot: CmuxSidebarSnapshot?
    var host: CmuxSidebarHost?

    private var heldSnapshot: CmuxSidebarSnapshot?

    override func menuClosed() {
        super.menuClosed()
        if let s = heldSnapshot { heldSnapshot = nil; apply(s) }
    }

    /// A new snapshot from cmux. Its sequence number and things the sidebar doesn't draw (terminal
    /// titles, for example) change all the time, so only publish when something shown changed.
    func apply(_ snap: CmuxSidebarSnapshot) {
        if menuOpen { heldSnapshot = snap; return }
        if snapshot.map(Self.shown) != Self.shown(snap) { snapshot = snap }
    }

    private struct Shown: Equatable {
        struct Row: Equatable {
            var id: UUID
            var title: String
            var isPinned: Bool
            var gitBranch: String?
            var unreadCount: Int
        }
        var selected: UUID?
        var rows: [Row]
    }

    private static func shown(_ s: CmuxSidebarSnapshot) -> Shown {
        Shown(selected: s.selectedWorkspaceID, rows: s.workspaces.map {
            Shown.Row(id: $0.id, title: $0.title, isPinned: $0.isPinned, gitBranch: $0.gitBranch, unreadCount: $0.unreadCount)
        })
    }

    func select(_ id: UUID) {
        Task { try? await host?.selectWorkspace(id) }
    }

    func extra(for id: UUID) -> DaemonState.Workspace? {
        daemon?.workspaces[id.uuidString]
    }
}
