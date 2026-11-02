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

    private var settings: DaemonState.Settings { model.daemon?.settings ?? DaemonState.Settings() }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            titleLine
            if !settings.hideAllDetails { details }
        }
        .padding(.leading, 9)
        // The workspace color as a stripe exactly as tall as the row's content.
        .overlay(alignment: .leading) {
            Capsule().fill(extra?.color.flatMap(Color.init(hex:)) ?? .clear).frame(width: 3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 6).fill(selected ? Color(hex: "#3D7BFF40")! : .clear))
        .contentShape(Rectangle())
        .onTapGesture { model.select(workspace.id) }
        .contextMenu { menu }
    }

    private var titleLine: some View {
        HStack(spacing: 4) {
            if settings.showAgentActivity && agentBusy {
                Image(systemName: "circle.dotted")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.accentColor)
                    .symbolEffect(.variableColor.iterative, options: .repeating)
            }
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
            sessionDots
            Spacer(minLength: 0)
            // Ports and pull requests ride along on the title line, so they don't make rows taller.
            if !settings.hideAllDetails { linkChips.fixedSize() }
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
    }

    /// One faint dot per Claude Code session running here (Tama menu → Sidebar to turn off).
    @ViewBuilder private var sessionDots: some View {
        let n = extra?.claudeSessions ?? 0
        if n > 0, model.daemon?.tamagoSettings?.claudeDots ?? true {
            HStack(spacing: 2) {
                ForEach(0 ..< min(n, 4), id: \.self) { _ in
                    Circle().frame(width: 3.5, height: 3.5)
                }
                if n > 4 { Text("+").font(.system(size: 8)) }
            }
            .foregroundStyle(Color.secondary.opacity(0.45))
            .help(n == 1 ? "1 Claude session" : "\(n) Claude sessions")
            .fixedSize()
        }
    }

    /// A coding agent is working here: the stock sidebar's loading spinner.
    private var agentBusy: Bool {
        (extra?.statuses ?? []).contains { $0.value.range(of: "running|working|thinking", options: [.regularExpression, .caseInsensitive]) != nil }
    }

    /// The stock sidebar's detail rows, each behind its cmux setting.
    @ViewBuilder private var details: some View {
        let small = Font.system(size: 10)
        if settings.showWorkspaceDescription, let d = extra?.description, !d.isEmpty {
            Text(d).font(small).foregroundStyle(.secondary).lineLimit(2)
        }
        if settings.showNotificationMessage, let n = extra?.notification, !n.isEmpty {
            Text(n).font(small).foregroundStyle(.secondary).lineLimit(max(1, settings.notificationMessageLineLimit))
        }
        branchAndPath
        if settings.showStatusPills, let statuses = extra?.statuses, !statuses.isEmpty {
            FlowRow(spacing: 3) {
                ForEach(statuses, id: \.key) { statusPill($0) }
            }
        }
        if settings.showProgress, let p = extra?.progress {
            VStack(alignment: .leading, spacing: 1) {
                Capsule().fill(Color.secondary.opacity(0.25)).frame(height: 3)
                    .overlay(alignment: .leading) {
                        GeometryReader { g in
                            Capsule().fill(Color.accentColor).frame(width: g.size.width * min(max(p.value, 0), 1))
                        }
                    }
                if !p.label.isEmpty { Text(p.label).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
        if settings.showLog, let logs = extra?.logs, !logs.isEmpty {
            ForEach(Array(logs.enumerated()), id: \.offset) { _, entry in
                Text(entry.text).font(.system(size: 9, design: .monospaced)).foregroundStyle(logColor(entry.level)).lineLimit(1)
            }
        }
        chips
    }

    @ViewBuilder private var branchAndPath: some View {
        let branch = settings.showGitBranch ? (extra?.branch ?? workspace.gitBranch).flatMap { $0.isEmpty ? nil : $0 } : nil
        let path = settings.showBranchDirectory ? extra?.path : nil
        let branchText = branch.map { b in
            HStack(spacing: 2) {
                if settings.showGitBranchIcon { Image(systemName: "arrow.triangle.branch") }
                Text(b + (extra?.dirty == true ? "*" : "")).lineLimit(1)
            }
        }
        let pathText = path.map { Text($0).lineLimit(1).truncationMode(settings.pathLastSegmentOnly ? .head : .middle) }
        Group {
            if settings.stackBranchDirectory {
                branchText
                pathText
            } else if branch != nil || path != nil {
                HStack(spacing: 4) {
                    branchText
                    if branch != nil && path != nil { Text("·") }
                    pathText
                }
            }
        }
        .font(.system(size: 9, design: .monospaced))
        .foregroundStyle(.secondary)
    }

    private func statusPill(_ s: DaemonState.Workspace.Status) -> some View {
        let color = s.color.flatMap(Color.init(hex:)) ?? .secondary
        return HStack(spacing: 2) {
            if let icon = s.icon { Image(systemName: icon) }
            Text("\(s.label): \(s.value)").lineLimit(1)
        }
        .font(.system(size: 9, weight: .medium))
        .foregroundStyle(color)
        .padding(.horizontal, 5)
        .padding(.vertical, 1)
        .background(Capsule().fill(color.opacity(0.15)))
    }

    /// Ports and pull requests as small chips on the title line; links open the way cmux's
    /// settings say. At most two, so the title keeps its room; the rest show as "+N" (with a
    /// tooltip listing them; the right-click menu opens any of them).
    @ViewBuilder private var linkChips: some View {
        let links = self.links
        if !links.isEmpty {
            HStack(spacing: 3) {
                ForEach(links.prefix(2), id: \.url) { link in
                    chip(link.label, icon: nil, action: link.action)
                }
                if links.count > 2 {
                    chip("+\(links.count - 2)", icon: nil, action: nil)
                        .help(links.dropFirst(2).map(\.label).joined(separator: ", "))
                }
            }
        }
    }

    private struct LinkChip {
        var label: String
        var url: String
        var action: (() -> Void)?
    }

    private var links: [LinkChip] {
        let id = workspace.id
        let ports = (settings.showPorts ? (extra?.ports ?? []) : []).map { port in
            LinkChip(label: ":\(port)", url: "http://localhost:\(port)") { [model] in
                model.act("open-url", workspace: id, ["url": "http://localhost:\(port)", "via": "port"])
            }
        }
        let prs = (settings.showPullRequests ? (extra?.prs ?? []) : []).map { pr in
            LinkChip(label: pr.label, url: pr.url, action: settings.makePullRequestsClickable ? { [model] in
                model.act("open-url", workspace: id, ["url": pr.url, "via": "pr"])
            } : nil)
        }
        return prs + ports
    }

    /// The SSH target, below the title.
    @ViewBuilder private var chips: some View {
        if settings.showSSH, let remote = extra?.remote {
            chip(remote.target + (remote.state.map { " · \($0)" } ?? ""), icon: "network.badge.shield.half.filled", action: nil)
        }
    }

    @ViewBuilder private func chip(_ text: String, icon: String?, action: (() -> Void)?) -> some View {
        let label = HStack(spacing: 2) {
            if let icon { Image(systemName: icon) }
            Text(text).lineLimit(1)
        }
        .font(.system(size: 9, design: .monospaced))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 5)
        .padding(.vertical, 1)
        .background(Capsule().stroke(Color.secondary.opacity(0.4), lineWidth: 0.5))
        if let action {
            Button(action: action) { label }.buttonStyle(.plain)
        } else {
            label
        }
    }

    private func logColor(_ level: String) -> Color {
        switch level {
        case "error": Color(hex: "#F7768E")!
        case "warning": Color(hex: "#E0AF68")!
        case "success": Color(hex: "#9ECE6A")!
        default: .secondary
        }
    }

    @ViewBuilder private var menu: some View {
        let id = workspace.id
        Button("Rename…") { renaming = id }
        let links = self.links.filter { $0.action != nil }
        if !links.isEmpty {
            Menu("Open") {
                ForEach(links, id: \.url) { link in Button(link.label) { link.action?() } }
            }
        }
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

/// Lays children out left to right and wraps to the next line when the row is full.
struct FlowRow: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        return CGSize(width: rows.map(\.width).max() ?? 0, height: rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows = [Row()]
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty && rows[rows.count - 1].width + spacing + size.width > width { rows.append(Row()) }
            let gap = rows[rows.count - 1].items.isEmpty ? 0 : spacing
            rows[rows.count - 1].items.append(i)
            rows[rows.count - 1].width += gap + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
