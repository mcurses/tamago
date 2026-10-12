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
