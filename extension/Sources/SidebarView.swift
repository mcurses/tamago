import CmuxExtensionKit
import SwiftUI

struct SidebarView: View {
    @ObservedObject var model: SidebarModel
    @State private var renaming: UUID?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    ForEach(workspaces, id: \.id) { ws in
                        WorkspaceRow(
                            workspace: ws,
                            selected: ws.id == model.snapshot?.selectedWorkspaceID,
                            extra: model.extra(for: ws.id),
                            model: model,
                            renaming: $renaming
                        )
                        .draggable(ws.id.uuidString)
                        .dropDestination(for: String.self) { items, _ in
                            guard let dragged = items.first.flatMap(UUID.init(uuidString:)), dragged != ws.id,
                                  let target = workspaces.firstIndex(where: { $0.id == ws.id }) else { return false }
                            model.act("reorder", workspace: dragged, ["index": String(target)])
                            return true
                        }
                    }
                }
                .padding(6)
            }
            if model.snapshot == nil {
                Text("Waiting for cmux…").font(.caption).foregroundStyle(.secondary).padding()
            }
            Divider()
            PetFooter(model: model)
        }
    }

    private var workspaces: [CmuxSidebarWorkspace] { model.snapshot?.workspaces ?? [] }
}

// MARK: - Workspace rows

private let palette: [(String, String)] = [
    ("Red", "#C0392B"), ("Orange", "#E67E22"), ("Amber", "#F1C40F"), ("Green", "#27AE60"),
    ("Teal", "#16A085"), ("Blue", "#2E86DE"), ("Purple", "#8E44AD"), ("Rose", "#E84393"),
]

struct WorkspaceRow: View {
    let workspace: CmuxSidebarWorkspace
    let selected: Bool
    let extra: DaemonState.Workspace?
    @ObservedObject var model: SidebarModel
    @Binding var renaming: UUID?
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Capsule()
                .fill(extra?.color.flatMap(Color.init(hex:)) ?? .clear)
                .frame(width: 3, height: 16)
            VStack(alignment: .leading, spacing: 1) {
                if renaming == workspace.id {
                    TextField("Name", text: $draft)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12))
                        .focused($focused)
                        .onSubmit {
                            model.act("rename", workspace: workspace.id, ["title": draft])
                            renaming = nil
                        }
                        .onExitCommand { renaming = nil }
                        .onAppear {
                            draft = workspace.title
                            focused = true
                        }
                } else {
                    Text(workspace.title)
                        .font(.system(size: 12, weight: selected ? .semibold : .regular))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                if let branch = workspace.gitBranch, !branch.isEmpty {
                    Text(branch)
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if workspace.isPinned {
                Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(.secondary)
            }
            if workspace.unreadCount > 0 {
                Text("\(workspace.unreadCount)")
                    .font(.system(size: 9, design: .monospaced)).bold()
                    .foregroundStyle(.white)
                    .padding(4)
                    .background(Circle().fill(Color.accentColor))
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 6).fill(selected ? Color(hex: "#3D7BFF40")! : .clear))
        .contentShape(Rectangle())
        .onTapGesture { model.select(workspace.id) }
        .contextMenu { menu }
    }

    @ViewBuilder private var menu: some View {
        let id = workspace.id
        Button("Rename…") { renaming = id }
        Button(workspace.isPinned ? "Unpin" : "Pin") { model.act(workspace.isPinned ? "unpin" : "pin", workspace: id) }
        Button(workspace.unreadCount > 0 ? "Mark as Read" : "Mark as Unread") {
            model.act(workspace.unreadCount > 0 ? "mark-read" : "mark-unread", workspace: id)
        }
        Divider()
        Button("Move to Top") { model.act("move-top", workspace: id) }
        Button("Move Up") { model.act("move-up", workspace: id) }
        Button("Move Down") { model.act("move-down", workspace: id) }
        Divider()
        Menu("Color") {
            ForEach(palette, id: \.0) { name, hex in
                Button(name) { model.act("set-color", workspace: id, ["color": hex]) }
            }
            Divider()
            Button("Clear Color") { model.act("clear-color", workspace: id) }
        }
        Divider()
        Button("Close Other Workspaces") { model.act("close-others", workspace: id) }
        Button("Close Workspace") { model.act("close", workspace: id) }
        if !model.daemonOnline {
            Divider()
            Text("Tama's daemon is offline; only selecting works")
        }
    }
}

// MARK: - Tama

struct PetFooter: View {
    @ObservedObject var model: SidebarModel
    /// Draw one fixed moment instead of a live timeline (scripts/render-pet.sh).
    var frozenAt: Date?
    @State private var renaming = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        if let frozenAt { footer(at: frozenAt) } else { live }
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
                if age < Pet.showSeconds {
                    speech(bubble).opacity(age > Pet.showSeconds / 2 ? 0.5 : 1)
                }
            }
            // Sprite and name tag as one centered block.
            HStack(alignment: .bottom, spacing: 10) {
                sprite(pet, seconds: seconds)
                VStack(alignment: .leading, spacing: 1) {
                    nameField
                    moodLine
                    if !model.daemonOnline {
                        Text("asleep (daemon offline)").font(.system(size: 9)).foregroundStyle(.tertiary)
                    } else if let at = model.daemon?.bubble.at, at > 0 {
                        Text(ago(seconds - at / 1000)).font(.system(size: 9)).foregroundStyle(.tertiary)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 12) // room for hearts and anger marks
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        // cmux lays a fade ("scrim") over the bottom of the sidebar, about the title bar height
        // plus 20pt; keep Tama above it.
        .padding(.bottom, 40)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .contextMenu { menu }
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

    @ViewBuilder private var moodLine: some View {
        if let mood = model.daemon?.mood, model.daemonOnline {
            HStack(spacing: 4) {
                Text(mood.name).foregroundStyle(moodColor(mood.name))
                if mood.eats {
                    Text(fullnessPips(mood.fullness)).foregroundStyle(mood.hungry ? Color(hex: "#F7768E")! : .secondary)
                        .help(mood.hungry ? "hungry" : "fullness")
                }
            }
            .font(.system(size: 9, design: .monospaced))
        }
    }

    private func moodColor(_ name: String) -> Color {
        switch name {
        case "ecstatic", "happy": Color(hex: "#9ECE6A")!
        case "content": Color(hex: "#7DCFFF")!
        case "grumpy", "restless": Color(hex: "#E0AF68")!
        case "furious", "sulking": Color(hex: "#F7768E")!
        default: Color.secondary
        }
    }

    private func fullnessPips(_ f: Double) -> String {
        let n = Int((f * 5).rounded())
        return String(repeating: "●", count: n) + String(repeating: "○", count: 5 - n)
    }

    private var name: String { model.daemon?.pet.name ?? "Tama" }

    @ViewBuilder private var nameField: some View {
        if renaming {
            TextField("Name", text: $draft)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .bold))
                .frame(width: 110)
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
            Text(name).font(.system(size: 12, weight: .bold))
        }
    }

    private func speech(_ bubble: DaemonState.Bubble) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text("re: \(bubble.about)").font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                Text(bubble.text).font(.system(size: 11)).lineLimit(5).fixedSize(horizontal: false, vertical: true)
            }
            .padding(7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: "#8A8A8A")!, lineWidth: 1))
            Text("╲").font(.system(size: 11, design: .monospaced)).foregroundStyle(Color(hex: "#8A8A8A")!)
                .frame(maxWidth: .infinity) // the pet sits centered below
        }
    }

    @ViewBuilder private var menu: some View {
        Button("Feed \(name)") { model.act("touch", ["kind": "feed"]) }
        Button("Pet \(name)") { model.act("touch", ["kind": "pet"]) }
        Button("Poke \(name)") { model.act("touch", ["kind": "poke"]) }
        Divider()
        Button("Rename \(name)…") { renaming = true }
        Menu("Species") {
            ForEach(Pet.speciesNames, id: \.self) { species in
                Button(species.prefix(1).uppercased() + species.dropFirst()) {
                    model.act("species", ["species": species])
                }
            }
        }
    }

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
