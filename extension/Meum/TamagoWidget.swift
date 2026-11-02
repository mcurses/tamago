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

    init(_ appearance: MeumWidgetAppearance, visible: Bool) {
        self.appearance = appearance
        self.visible = visible
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
        look = CardLook(host.appearance, visible: host.visibility.isVisible)
        model.paused = !look.visible
    }

    func appearanceDidChange(_ appearance: MeumWidgetAppearance) { look.appearance = appearance }

    func visibilityDidChange(_ visibility: MeumWidgetVisibility) {
        look.visible = visibility.isVisible
        model.paused = !visibility.isVisible
        if visibility.isVisible { Task { await model.refresh() } }
    }

    func willUnload() { model.stop() }

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
        PetFooter(model: model, bottomInset: look.appearance.bottomInset + 8, animating: look.visible, inCmux: false)
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
