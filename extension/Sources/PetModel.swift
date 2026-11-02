import AppKit
import SwiftUI

/// Tama's state from the daemon, polled once a second, and the actions Tama's menu sends. Knows
/// nothing about the host: the cmux sidebar (SidebarModel) and the meum widget both build on it.
@MainActor
class PetModel: ObservableObject {
    @Published private(set) var daemon: DaemonState?
    @Published private(set) var daemonOnline = false
    /// No polling while nobody can see Tama (the meum widget sets this from its visibility).
    var paused = false

    private let client: DaemonClient
    private var poller: Task<Void, Never>?
    // Every publish redraws the view, and a redraw closes any open menu. So while a menu is
    // open, updates wait here and are applied when it closes.
    private(set) var menuOpen = false
    private var heldDaemon: DaemonState?
    private var menuObservers: [NSObjectProtocol] = []

    init(client: DaemonClient = DaemonClient()) {
        self.client = client
        poll()
        watchMenus()
    }

    /// A model with fixed state and no daemon polling, for scripts/render-pet.sh.
    init(preview state: DaemonState) {
        client = DaemonClient()
        daemon = state
        daemonOnline = true
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

    /// Applies what waited while a menu was open. Subclasses apply their own held updates too.
    func menuClosed() {
        menuOpen = false
        if let d = heldDaemon { heldDaemon = nil; publish(d) }
    }

    private func publish(_ state: DaemonState) {
        if menuOpen { heldDaemon = state; return }
        if state != daemon { daemon = state }
    }

    private func poll() {
        poller = Task { [weak self] in
            while !Task.isCancelled {
                if self?.paused == false { await self?.refresh() }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    /// Stops polling and watching menus, for a host that unloads the view.
    func stop() {
        poller?.cancel()
        poller = nil
        for o in menuObservers { NotificationCenter.default.removeObserver(o) }
        menuObservers = []
    }

    deinit {
        poller?.cancel()
        for o in menuObservers { NotificationCenter.default.removeObserver(o) }
    }

    func refresh() async {
        // Publish only real changes: every publish redraws the view, which closes open menus.
        do {
            publish(try await client.state())
            if !daemonOnline { daemonOnline = true }
        } catch {
            if daemonOnline { daemonOnline = false }
        }
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
}
