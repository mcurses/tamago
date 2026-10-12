// Tamago as a compiled cmux sidebar: the workspace list scrolls on its own, Tama stays pinned below
// it. Workspaces and selection come from cmux through CmuxExtensionKit; Tama's state and every
// workspace action the extension API lacks (pin, rename, reorder, colors, …) go through the daemon
// (daemon/server.mjs), because the extension runs sandboxed.

import CmuxExtensionKit
import SwiftUI

@main
final class TamagoSidebarExtension: @MainActor CmuxSidebarExtension {
    // Changing the scopes makes cmux ask for approval again.
    static let manifest = CmuxExtensionManifest(
        id: "io.github.mcurses.tamago.sidebar",
        displayName: "Tamago",
        readScopes: [.workspaceList, .workspaceMetadata],
        actionScopes: [.selectWorkspace]
    )

    private let model = SidebarModel()

    required init() {}

    var body: some View {
        SidebarView(model: model)
    }

    func update(context: CmuxSidebarContext) {
        model.snapshot = context.snapshot
        model.host = context.host
    }
}

@MainActor
final class SidebarModel: ObservableObject {
    @Published var snapshot: CmuxSidebarSnapshot?
    @Published private(set) var daemon: DaemonState?
    @Published private(set) var daemonOnline = false
    var host: CmuxSidebarHost?

    private let client = DaemonClient()
    private var poller: Task<Void, Never>?

    init() {
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
