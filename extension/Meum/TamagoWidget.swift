// Tama in meum: a native widget (MeumKit) in the card under meum's sidebar. It shows only the pet,
// its bubble and its menu; meum's own sidebar shows the workspaces. Everything Tama knows comes from
// the daemon over HTTP, as in the cmux sidebar.

import AppKit
import MeumKit
import SwiftUI

@_cdecl("meum_widget_main")
public func meumWidgetMain() -> UnsafeMutableRawPointer {
    // A widget library has no bundle of its own; scripts/build-meum-widget.sh puts species.json next to it.
    Pet.speciesURL = besideLibrary("species.json")
    return MeumWidgetRegistration(manifest: .init(id: "io.github.mcurses.tamago", displayName: "Tamago", version: "1")) { host in
        TamagoWidget(host: host)
    }.export()
}

/// A file in the folder this library was loaded from.
private func besideLibrary(_ name: String) -> URL? {
    var info = Dl_info()
    guard dladdr(#dsohandle, &info) != 0, let file = info.dli_fname else { return nil }
    return URL(fileURLWithPath: String(cString: file)).deletingLastPathComponent().appendingPathComponent(name)
}

/// What meum tells the widget about its card.
@MainActor
final class CardLook: ObservableObject {
    @Published var appearance: MeumWidgetAppearance
    @Published var visible: Bool
    /// meum's sidebar is collapsed to its rail.
    @Published var collapsed: Bool

    init(_ appearance: MeumWidgetAppearance, visible: Bool, collapsed: Bool) {
        self.appearance = appearance
        self.visible = visible
        self.collapsed = collapsed
    }
}

@MainActor
final class TamagoWidget: MeumWidget {
    let host: MeumWidgetHost
    let model: PetModel
    let look: CardLook

    lazy var view: NSView = {
        let v = NSHostingView(rootView: TamagoCard(model: model, look: look, host: host))
        v.sizingOptions = []
        return v
    }()

    init(host: MeumWidgetHost) {
        self.host = host
        model = PetModel(client: DaemonClient(tokenFile: Self.dataDirectory(host).appendingPathComponent("token").path))
        look = CardLook(host.appearance, visible: host.visibility.isVisible, collapsed: host.isSidebarCollapsed)
        model.paused = !look.visible
    }

    func appearanceDidChange(_ appearance: MeumWidgetAppearance) { look.appearance = appearance }

    func visibilityDidChange(_ visibility: MeumWidgetVisibility) {
        look.visible = visibility.isVisible
        model.paused = !visibility.isVisible
        if visibility.isVisible { Task { await model.refresh() } }
    }

    func willUnload() { model.stop() }

    var supportsCollapsedSidebar: Bool { true }

    func sidebarCollapsedDidChange(_ collapsed: Bool) { look.collapsed = collapsed }

    /// `meum widget send <tab> '{"look": "rail"}'` (or "full") shows this instance as in the collapsed
    /// sidebar, to check the rail look in a tile, where it can be screenshotted.
    func receive(_ message: String, reply: @escaping @MainActor (String) -> Void) {
        let json = (try? JSONSerialization.jsonObject(with: Data(message.utf8))) as? [String: Any]
        switch json?["look"] as? String {
        case "rail": look.collapsed = true; reply(#"{"ok": true}"#)
        case "full": look.collapsed = false; reply(#"{"ok": true}"#)
        default: reply(#"{"error": "send {\"look\": \"rail\"} or {\"look\": \"full\"}"}"#)
        }
    }

    /// meum's data folder for this widget, where the daemon (the widget's helper) keeps Tama's state:
    /// `<meum state dir>/widgets/<id>/`. Worked out from the socket, which sits in meum's state dir,
    /// rather than `host.dataDirectory`, which meum builds before November 2026 don't have.
    static func dataDirectory(_ host: MeumWidgetHost) -> URL {
        URL(fileURLWithPath: host.socketPath).deletingLastPathComponent()
            .appendingPathComponent("widgets").appendingPathComponent("io.github.mcurses.tamago")
    }
}

private struct HeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Tama at the bottom of the card. The card follows Tama's height: taller while a bubble shows.
struct TamagoCard: View {
    @ObservedObject var model: PetModel
    @ObservedObject var look: CardLook
    let host: MeumWidgetHost
    @State private var asked: CGFloat = 0

    var body: some View {
        PetFooter(model: model, bottomInset: look.appearance.bottomInset + 8, animating: look.visible, inCmux: false,
                  openWorkspace: { id in if let uuid = UUID(uuidString: id) { host.selectWorkspace(uuid) } },
                  collapsed: look.collapsed)
            .fixedSize(horizontal: false, vertical: true)
            .background(GeometryReader { g in Color.clear.preference(key: HeightKey.self, value: g.size.height) })
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .onPreferenceChange(HeightKey.self) { height in
                let h = height.rounded(.up)
                guard h > 0, abs(h - asked) >= 1 else { return }
                asked = h
                host.setPreferredHeight(h)
            }
            .environment(\.colorScheme, look.appearance.scheme == .dark ? .dark : .light)
    }
}
