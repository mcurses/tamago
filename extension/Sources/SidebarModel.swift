import CmuxExtensionKit
import SwiftUI

/// What the sidebar shows: the workspace snapshot from cmux plus Tama's state from the daemon.
@MainActor
final class SidebarModel: ObservableObject {
    @Published var snapshot: CmuxSidebarSnapshot?
    @Published private(set) var daemon: DaemonState?
    @Published private(set) var daemonOnline = false
    var host: CmuxSidebarHost?

    private let client = DaemonClient()
    private var poller: Task<Void, Never>?

    init() {
        poll()
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
    }

    func refresh() async {
        do {
            daemon = try await client.state()
            daemonOnline = true
        } catch {
            daemonOnline = false
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
