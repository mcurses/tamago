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
    @State private var renaming = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let now = context.date
            let tick = Int(now.timeIntervalSince1970)
            let pet = Pet(state: model.daemon, now: now)
            VStack(alignment: .leading, spacing: 4) {
                if let bubble = model.daemon?.bubble, bubble.at > 0 {
                    let age = now.timeIntervalSince1970 - bubble.at / 1000
                    if age < Pet.showSeconds {
                        speech(bubble).opacity(age > Pet.showSeconds / 2 ? 0.5 : 1)
                    }
                }
                HStack(alignment: .bottom, spacing: 8) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(pet.lines(tick: tick).enumerated()), id: \.offset) { _, line in
                            Text(line)
                        }
                    }
                    .font(.system(size: 11, design: .monospaced))
                    VStack(alignment: .leading, spacing: 1) {
                        nameField
                        Text("★ lv 1").font(.system(size: 9, design: .monospaced)).foregroundStyle(Color(hex: "#E0AF68")!)
                        if !model.daemonOnline {
                            Text("asleep (daemon offline)").font(.system(size: 9)).foregroundStyle(.tertiary)
                        } else if let at = model.daemon?.bubble.at, at > 0 {
                            Text(ago(now.timeIntervalSince1970 - at / 1000)).font(.system(size: 9)).foregroundStyle(.tertiary)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            // cmux lays a fade ("scrim") over the bottom of the sidebar, about the title bar height
            // plus 20pt; keep Tama above it.
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .contextMenu { menu }
        }
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
            Text("     ╲").font(.system(size: 11, design: .monospaced)).foregroundStyle(Color(hex: "#8A8A8A")!)
        }
    }

    @ViewBuilder private var menu: some View {
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
