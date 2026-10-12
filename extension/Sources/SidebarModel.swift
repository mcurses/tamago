import CmuxExtensionKit
import SwiftUI

/// What the sidebar shows: the workspace snapshot from cmux plus Tama's state from the daemon.
@MainActor
final class SidebarModel: ObservableObject {
    @Published private(set) var snapshot: CmuxSidebarSnapshot?
    @Published private(set) var daemon: DaemonState?
    @Published private(set) var daemonOnline = false
    var host: CmuxSidebarHost?

    private let client = DaemonClient()
    private var poller: Task<Void, Never>?
    // Every publish redraws the sidebar, and a redraw closes any open menu. So while a menu is
    // open, updates wait here and are applied when it closes.
    private var menuOpen = false
    private var heldSnapshot: CmuxSidebarSnapshot?
    private var heldDaemon: DaemonState?
    private var menuObservers: [NSObjectProtocol] = []

    init() {
        poll()
        watchMenus()
    }

    private func watchMenus() {
        let center = NotificationCenter.default
        menuObservers = [
            center.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.menuOpen = true }
            },
            center.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.menuClosed() }
            },
        ]
    }

    private func menuClosed() {
        menuOpen = false
        if let s = heldSnapshot { heldSnapshot = nil; apply(s) }
        if let d = heldDaemon { heldDaemon = nil; publish(d) }
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

    private func publish(_ state: DaemonState) {
        if menuOpen { heldDaemon = state; return }
        if state != daemon { daemon = state }
    }

    /// A model with fixed state and no daemon polling, for scripts/render-pet.sh.
    init(preview state: DaemonState) {
        daemon = state
        daemonOnline = true
    }

    private func poll() {
        poller = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    deinit {
        poller?.cancel()
        for o in menuObservers { NotificationCenter.default.removeObserver(o) }
    }

    func refresh() async {
        // Publish only real changes: every publish redraws the sidebar, which closes open menus.
        do {
            publish(try await client.state())
            if !daemonOnline { daemonOnline = true }
        } catch {
            if daemonOnline { daemonOnline = false }
        }
    }

    func select(_ id: UUID) {
        Task { try? await host?.selectWorkspace(id) }
    }

    /// Sends an action to the daemon, e.g. `act("pin", workspace: id)`.
    func act(_ type: String, workspace: UUID? = nil, _ extra: [String: String] = [:]) {
        var body = extra
        body["type"] = type
        if let workspace { body["workspace"] = workspace.uuidString }
        Task {
            try? await client.action(body)
            await refresh()
        }
    }

    func extra(for id: UUID) -> DaemonState.Workspace? {
        daemon?.workspaces[id.uuidString]
    }
}
