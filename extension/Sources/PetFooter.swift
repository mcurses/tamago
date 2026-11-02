import SwiftUI

/// Tama with its speech bubble and menu. Shared by the cmux sidebar and the meum widget.
struct PetFooter: View {
    @ObservedObject var model: PetModel
    /// Draw one fixed moment instead of a live timeline (scripts/render-pet.sh).
    var frozenAt: Date?
    /// Space kept free below Tama: cmux lays a fade ("scrim") over the bottom of its sidebar, about
    /// the title bar height plus 20 pt; meum has none.
    var bottomInset: CGFloat = 40
    /// False while nobody can see Tama: draw one still frame instead of animating.
    var animating = true
    /// Menu entries that are about cmux's sidebar (session dots, where workspace details are set).
    var inCmux = true
    /// Shows the workspace a remark is about (meum: `host.selectWorkspace`); nil leaves "re:" plain.
    var openWorkspace: ((String) -> Void)?
    @State private var renaming = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        // The menu hangs outside the timeline: anything inside is rebuilt every tick, and a
        // rebuilt menu closes while it's open.
        Group {
            if let frozenAt { footer(at: frozenAt) } else if animating { live } else { footer(at: .now) }
        }
        .contentShape(Rectangle())
        .contextMenu { menu }
    }

    @ViewBuilder private var live: some View {
        // Smooth frames only while a feed / pet / poke animation runs; the daemon poll re-renders
        // this every second, which switches back to the cheap schedule afterwards.
        if reacting(at: .now) {
            TimelineView(.animation(minimumInterval: 1 / 30)) { footer(at: $0.date) }
        } else {
            TimelineView(.periodic(from: .now, by: 1)) { footer(at: $0.date) }
        }
    }

    static let spriteWidth: CGFloat = 84 // 12 monospaced characters at 11 pt, the widest species
    static let tagWidth: CGFloat = 150

    private func reacting(at now: Date) -> Bool {
        guard let at = model.daemon?.reaction?.at, at > 0 else { return false }
        return now.timeIntervalSince1970 - at / 1000 < Pet.reactSeconds + 0.5
    }

    private func footer(at now: Date) -> some View {
        let seconds = now.timeIntervalSince1970
        let pet = Pet(state: model.daemon, now: now)
        return VStack(spacing: 4) {
            if let bubble = model.daemon?.bubble, bubble.at > 0 {
                let age = seconds - bubble.at / 1000
                // A fresh +1 keeps the bubble up a moment longer, to take it back.
                let clicked = bubble.likedAt.map { seconds - $0 / 1000 < 2 } ?? false
                if age < Pet.showSeconds || clicked {
                    speech(bubble, age: age).opacity(age > Pet.showSeconds / 2 ? 0.5 : 1)
                }
            }
            // Sprite centered with the name below it, both in fixed boxes, so changing text never
            // moves Tama.
            VStack(spacing: 3) {
                sprite(pet, seconds: seconds)
                    .frame(width: Self.spriteWidth)
                nameField
                    .frame(width: Self.tagWidth)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 12) // room for hearts and anger marks
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .padding(.bottom, bottomInset)
        .frame(maxWidth: .infinity)
    }

    // MARK: sprite and reactions

    private func sprite(_ pet: Pet, seconds: Double) -> some View {
        let r = pet.reaction
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(pet.lines(fifths: Int(seconds * 5)).enumerated()), id: \.offset) { _, line in
                Text(line)
            }
        }
        .font(.system(size: 11, design: .monospaced))
        .offset(x: shake(r, seconds: seconds))
        .overlay(alignment: .trailing) { if let r, r.kind == "feed" { snack(r) } }
        .overlay(alignment: .top) { if let r, r.kind == "pet" { stroke(r) } }
        .overlay(alignment: .top) { if let r { marks(r) } }
    }

    /// A poke jolts Tama; a hated touch makes it shake it off.
    private func shake(_ r: Pet.Reaction?, seconds: Double) -> CGFloat {
        guard let r else { return 0 }
        let jolt = r.kind == "poke" && r.progress < 0.2
        let fit = r.response == "hate" && r.progress > 0.35 && r.progress < 0.7
        return jolt || fit ? CGFloat(sin(seconds * 70) * (jolt ? 3 : 2)) : 0
    }

    /// The snack flies in from the right; a refused one bounces off and drops.
    @ViewBuilder private func snack(_ r: Pet.Reaction) -> some View {
        let p = r.progress
        if r.response == "hate" {
            if p < 0.7 {
                let fly = min(p / 0.3, 1)
                let drop = max(0, p - 0.3) / 0.4
                Text("●").font(.system(size: 10)).foregroundStyle(Color(hex: "#E0AF68")!)
                    .offset(x: 34 - 22 * fly + 14 * drop, y: -10 + 40 * drop * drop)
                    .opacity(1 - drop)
            }
        } else if p < 0.3 {
            Text("●").font(.system(size: 10)).foregroundStyle(Color(hex: "#E0AF68")!)
                .offset(x: 34 * (1 - p / 0.3), y: -10)
        } else if p < 0.6 {
            Text("nom").font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
                .offset(x: 26, y: -14 - 8 * (p - 0.3))
        }
    }

    /// A hand stroking over Tama's head.
    @ViewBuilder private func stroke(_ r: Pet.Reaction) -> some View {
        if r.progress < 0.45 {
            Text("~").font(.system(size: 12, design: .monospaced)).foregroundStyle(.secondary)
                .offset(x: CGFloat(sin(r.progress * 40) * 12), y: -8)
        }
    }

    /// Hearts, a shrug or anger marks float up once Tama has made up its mind.
    @ViewBuilder private func marks(_ r: Pet.Reaction) -> some View {
        let start = r.kind == "poke" ? 0.2 : 0.45
        if r.progress > start {
            let q = (r.progress - start) / (1 - start)
            let (symbols, color): (String, Color) = switch r.response {
            case "love": (r.kind == "poke" ? "♪ ♪" : "♥ ♥", Color(hex: "#FF6B9A")!)
            case "hate": ("# !", Color(hex: "#F7768E")!)
            default: ("…", Color.secondary)
            }
            Text(symbols).font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(color)
                .offset(x: r.response == "love" ? CGFloat(sin(q * 9) * 3) : 0, y: -6 - 18 * q)
                .opacity(q > 0.7 ? (1 - q) / 0.3 : 1)
        }
    }

    // MARK: name tag

    private var name: String { model.daemon?.pet.name ?? "Tama" }

    @ViewBuilder private var nameField: some View {
        if renaming {
            TextField("Name", text: $draft)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .bold))
                .multilineTextAlignment(.center)
                .frame(width: Self.tagWidth)
                .focused($focused)
                .onSubmit {
                    model.act("pet-name", ["name": draft])
                    renaming = false
                }
                .onExitCommand { renaming = false }
                .onAppear {
                    draft = name
                    focused = true
                }
        } else {
            // Dimmed with "asleep" while the daemon is down, instead of an extra row.
            Text(model.daemonOnline ? name : "\(name) · asleep")
                .font(.system(size: 12, weight: .bold)).lineLimit(1).truncationMode(.tail)
                .foregroundStyle(model.daemonOnline ? .primary : .tertiary)
        }
    }

    /// "re: <workspace>", a link to the workspace when the host can show it.
    @ViewBuilder private func about(_ bubble: DaemonState.Bubble) -> some View {
        let label = Text("re: \(bubble.about)").font(.system(size: 9)).lineLimit(1)
        if let id = bubble.aboutId, let openWorkspace {
            Button { openWorkspace(id) } label: { label.underline() }
                .buttonStyle(.plain).foregroundStyle(.secondary)
                .help("Show \(bubble.about)")
                .onHover { inside in if inside { NSCursor.pointingHand.push() } else { NSCursor.pop() } }
        } else {
            label.foregroundStyle(.secondary)
        }
    }

    private func speech(_ bubble: DaemonState.Bubble, age: Double) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                about(bubble)
                if let action = bubble.action, !action.isEmpty {
                    Text(verbatim: "*\(action)*").font(.system(size: 10).italic()).foregroundStyle(.secondary).lineLimit(2)
                }
                Text(bubble.text).font(.system(size: 11)).lineLimit(5).fixedSize(horizontal: false, vertical: true)
            }
            .padding(7)
            .padding(.bottom, 6) // room for the +1
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: "#8A8A8A")!, lineWidth: 1))
            .overlay(alignment: .bottomTrailing) { plusOne(bubble) }
            ZStack(alignment: .topTrailing) {
                // The tail points down at the centered sprite.
                Text("╲").font(.system(size: 11, design: .monospaced)).foregroundStyle(Color(hex: "#8A8A8A")!)
                    .frame(maxWidth: .infinity)
                    .offset(x: -4) // a backslash leans right; this puts its tip over the sprite's middle
                // When it was said, like a message timestamp.
                Text(ago(age)).font(.system(size: 9)).foregroundStyle(.tertiary).padding(.trailing, 4).padding(.top, 1)
            }
        }
    }

    /// Faint until clicked: a +1 says the developer loved this remark (counted once the bubble is gone).
    private func plusOne(_ bubble: DaemonState.Bubble) -> some View {
        let on = bubble.liked == true
        return Text("+1")
            .font(.system(size: 9, weight: on ? .bold : .regular, design: .monospaced))
            .foregroundStyle(on ? Color(hex: "#FF6B9A")! : Color.secondary.opacity(0.35))
            .padding(.horizontal, 5).padding(.vertical, 3)
            .contentShape(Rectangle())
            .onTapGesture { model.act("like", ["at": String(format: "%.0f", bubble.at), "liked": on ? "false" : "true"]) }
            .help(on ? "Take the +1 back" : "+1: I loved this one")
    }

    @ViewBuilder private var menu: some View {
        Button("Feed") { model.act("touch", ["kind": "feed"]) }
        Button("Pet") { model.act("touch", ["kind": "pet"]) }
        Button("Poke") { model.act("touch", ["kind": "poke"]) }
        Button("Listen") { model.act("listen") }
        Divider()
        Menu("Talk") {
            let talk = settings?.talk ?? "normal"
            ForEach([("chatty", "Chatty"), ("normal", "Normal"), ("quiet", "Quiet"), ("muted", "Muted (only answers when you ask)")], id: \.0) { key, label in
                Button(checked(talk == key, label)) { model.act("tamago-setting", ["key": "talk", "value": key]) }
            }
        }
        Menu("Species") {
            ForEach(Pet.speciesNames, id: \.self) { species in
                Button(species.prefix(1).uppercased() + species.dropFirst()) {
                    model.act("species", ["species": species])
                }
            }
        }
        Button("Rename \(name)…") { renaming = true }
        Menu("Settings") {
            Menu("Model") {
                let current = settings?.model ?? "sonnet"
                ForEach([("haiku", "Haiku (lightest on your usage)"), ("sonnet", "Sonnet"), ("opus", "Opus (heaviest on your usage)")], id: \.0) { key, label in
                    Button(checked(current == key, label)) { model.act("tamago-setting", ["key": "model", "value": key]) }
                }
            }
            Menu("Language") {
                let current = settings?.language ?? "English"
                ForEach(Self.languages, id: \.0) { key, label in
                    Button(checked(current == key, label)) { model.act("tamago-setting", ["key": "language", "value": key]) }
                }
                if !Self.languages.contains(where: { $0.0 == current }) { Button(checked(true, current)) {} }
            }
            if inCmux {
                let dots = settings?.claudeDots ?? true
                Button(checked(dots, "Claude Session Dots")) {
                    model.act("tamago-setting", ["key": "claudeDots", "value": dots ? "false" : "true"])
                }
            }
            let updates = settings?.checkUpdates ?? true
            Button(checked(updates, "Check for Updates Daily")) {
                model.act("tamago-setting", ["key": "checkUpdates", "value": updates ? "false" : "true"])
            }
            if inCmux {
                Divider()
                Text("Workspace details: cmux Settings → Sidebar")
            }
        }
        if let version = model.daemon?.version {
            Divider()
            if let latest = version.latest {
                if version.updating == true {
                    Text("Updating to \(latest)…")
                } else {
                    Button("Update Tamago to \(latest)") { model.act("update") }
                }
            } else {
                Button("Tamago \(version.current): Check for Updates") { model.act("check-update") }
            }
        }
    }

    private var settings: DaemonState.TamagoSettings? { model.daemon?.tamagoSettings }

    private func checked(_ on: Bool, _ label: String) -> String { on ? "✓ " + label : label }

    /// Stored as the English name, which is what the prompt says; shown in its own language.
    static let languages = [
        ("English", "English"), ("German", "Deutsch"), ("Spanish", "Español"), ("French", "Français"),
        ("Italian", "Italiano"), ("Portuguese", "Português"), ("Dutch", "Nederlands"), ("Polish", "Polski"),
        ("Japanese", "日本語"), ("Korean", "한국어"), ("Chinese", "中文"),
    ]

    private func ago(_ seconds: Double) -> String {
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        return "\(Int(seconds / 3600))h ago"
    }
}

extension Color {
    /// "#RRGGBB" or "#RRGGBBAA".
    init?(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
        let rgba = s.count == 6 ? (v << 8) | 0xFF : v
        self.init(
            .sRGB,
            red: Double((rgba >> 24) & 0xFF) / 255,
            green: Double((rgba >> 16) & 0xFF) / 255,
            blue: Double((rgba >> 8) & 0xFF) / 255,
            opacity: Double(rgba & 0xFF) / 255
        )
    }
}
