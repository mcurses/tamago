import CmuxExtensionKit
import SwiftUI

@main
final class TamagoSidebarExtension: @MainActor CmuxSidebarExtension {
    static let manifest = CmuxExtensionManifest(
        id: "io.github.mcurses.tamago.sidebar",
        displayName: "Tamago",
        readScopes: [.workspaceList, .workspaceMetadata],
        actionScopes: [.selectWorkspace]
    )

    @MainActor final class Model: ObservableObject {
        @Published var snapshot: CmuxSidebarSnapshot?
    }

    private let model = Model()

    required init() {}

    var body: some View {
        ProbeView(model: model)
    }

    func update(context: CmuxSidebarContext) {
        model.snapshot = context.snapshot
    }
}

struct ProbeView: View {
    @ObservedObject var model: TamagoSidebarExtension.Model
    var body: some View {
        VStack(alignment: .leading) {
            Text("Tamago probe: \(model.snapshot?.workspaces.count ?? -1) workspaces")
            Spacer()
            Text("bottom").foregroundStyle(.secondary)
        }
        .padding(8)
    }
}
