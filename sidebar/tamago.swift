// Tamago: cmux custom sidebar = workspace list + a pinned ASCII pet.
// The pet's comments arrive from daemon/tamago.mjs through the selected workspace's
// progress label, encoded as "tamago|<epoch>|<mood>|<text>".

// Knobs. The host wraps the sidebar in a ScrollView and gives no height, so the pinned footer
// needs it spelled out. Keep sidebarHeight <= window height - 56 (measured: content starts ~32pt
// below the window top, the host adds 16pt bottom padding, plus a little slack); any more and the
// whole sidebar becomes scrollable. windowHeight 1084 = full-height window on a 14" MacBook Pro.
func windowHeight() -> Int { return 1084 }
func sidebarHeight() -> Int { return windowHeight() - 56 }
func footerHeight() -> Int { return 210 }
func bubbleWidth() -> Int { return 200 }
func petName() -> String { return "Tama" }
func showSeconds() -> Int { return 1200 }
func talkSeconds() -> Int { return 6 }

func tamaLabel() -> String {
    // Note: `obj != nil` on a missing object is not reliably true/false in this interpreter;
    // member access on a missing value falls through to an empty result instead.
    let sel = workspaces.filter { $0.selected }
    if sel.count == 0 { return "" }
    let label = "\(sel[0].progress.label)"
    return label.hasPrefix("tamago|") ? label : ""
}

func tamaPart(_ i) -> String {
    let label = tamaLabel()
    if label == "" { return "" }
    let parts = label.split(separator: "|")
    if parts.count <= i { return "" }
    return parts[i]
}

func tamaAge() -> Int {
    let at = tamaPart(1)
    if at == "" { return 999999 }
    return clock.epoch - Int(at)
}

func hasComment() -> Bool { return tamaAge() < showSeconds() }
func talking() -> Bool { return tamaAge() < talkSeconds() }
func mood() -> String { return hasComment() ? tamaPart(2) : "idle" }

func eyes(_ t) -> String {
    let m = mood()
    if m == "sleepy" { return "-  -" }
    if t % 9 == 8 { return "-  -" }
    if m == "shock" { return "O  O" }
    if m == "happy" { return "^  ^" }
    if m == "smug" { return "¬  ¬" }
    if m == "sad" { return "T  T" }
    return "°  °"
}

func mouth(_ t) -> String {
    if talking() { return t % 2 == 0 ? "o " : "- " }
    let m = mood()
    if m == "shock" { return "O " }
    if m == "sad" { return "n " }
    if m == "sleepy" { return "~ " }
    return "ω "
}

func bob(_ t) -> String { return t % 4 == 1 ? " " : "" }

func sprite(_ t) -> some View {
    VStack(alignment: .leading, spacing: 0) {
        Text(bob(t) + (mood() == "sleepy" ? "   .--. z " : "   .--.   ")).monospaced()
        Text(bob(t) + "  /    \  ").monospaced()
        Text(bob(t) + " | " + eyes(t) + " | ").monospaced()
        Text(bob(t) + " |  " + mouth(t) + "  | ").monospaced()
        Text(bob(t) + "  \____/  ").monospaced()
        Text(t % 2 == 0 ? "   ^  ^   " : "   ^   ^  ").monospaced()
    }
    .font(.system(size: 11, design: .monospaced))
}

func agoLabel(_ secs) -> String {
    if secs < 60 { return "just now" }
    if secs < 3600 { return "\(secs / 60)m ago" }
    return "\(secs / 3600)h ago"
}

func act(_ w, _ action) {
    cmux("workspace.action", workspace_id: w.id, action: action)
}

func colorItem(_ w, _ name, _ hex) -> some View {
    Button(name) { cmux("workspace.action", workspace_id: w.id, action: "set_color", color: hex) }
}

func menu(_ w) -> some View {
    // No text input exists in sidebars; the daemon sees this marker and shows a rename dialog.
    Button("Rename…") { cmux("workspace.action", workspace_id: w.id, action: "set_description", description: "tamago:rename") }
    Button(w.pinned ? "Unpin" : "Pin") { act(w, w.pinned ? "unpin" : "pin") }
    Button(w.unread > 0 ? "Mark as Read" : "Mark as Unread") { act(w, w.unread > 0 ? "mark_read" : "mark_unread") }
    Divider()
    Button("Move to Top") { act(w, "move_top") }
    Button("Move Up") { act(w, "move_up") }
    Button("Move Down") { act(w, "move_down") }
    Divider()
    Menu("Color") {
        colorItem(w, "Red", "#C0392B")
        colorItem(w, "Orange", "#E67E22")
        colorItem(w, "Amber", "#F1C40F")
        colorItem(w, "Green", "#27AE60")
        colorItem(w, "Teal", "#16A085")
        colorItem(w, "Blue", "#2E86DE")
        colorItem(w, "Purple", "#8E44AD")
        colorItem(w, "Rose", "#E84393")
        Divider()
        Button("Clear Color") { act(w, "clear_color") }
    }
    Divider()
    Button("Close Other Workspaces") { act(w, "close_others") }
    Button("Close Workspace") { cmux("workspace.close", workspace_id: w.id) }
}

func row(_ w) -> some View {
    Button(action: { cmux("workspace.select", workspace_id: w.id) }) {
        HStack(spacing: 6) {
            Capsule().frame(width: 3, height: 16).foregroundColor("\(w.color)" != "" ? w.color : "#00000000")
            VStack(alignment: .leading, spacing: 1) {
                Text(w.title).font(.system(size: 12)).fontWeight(w.selected ? .semibold : .regular).lineLimit(1).truncationMode(.tail)
                if "\(w.branch)" != "" {
                    Text(w.branch).font(.system(size: 9, design: .monospaced)).foregroundColor(.secondary).lineLimit(1)
                }
            }
            Spacer()
            if w.pinned {
                Image(systemName: "pin.fill").font(.system(size: 9)).foregroundColor(.secondary)
            }
            if w.unread > 0 {
                Text("\(w.unread)").font(.system(size: 9, design: .monospaced)).bold()
                    .foregroundColor("#FFFFFF")
                    .padding(4)
                    .background { Circle().foregroundColor("accent") }
            }
        }
        .padding(6)
        // Near-invisible fill keeps the whole row clickable; a fully clear one isn't hit-tested.
        .background { RoundedRectangle(cornerRadius: 6).foregroundColor(w.selected ? "#3D7BFF40" : "#80808003") }
    }
    .contextMenu { menu(w) }
}

VStack(alignment: .leading, spacing: 0) {
    ScrollView {
        VStack(alignment: .leading, spacing: 1) {
            Reorderable(workspaces, move: "workspace.reorder") { w in
                row(w)
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, minHeight: sidebarHeight() - footerHeight(), alignment: .topLeading)
    }
    .frame(height: sidebarHeight() - footerHeight(), alignment: .top)

    Divider()

    VStack(alignment: .leading, spacing: 4) {
        Spacer()
        if hasComment() {
            Text(tamaPart(3))
                .font(.system(size: 11))
                .lineLimit(5)
                // TODO: fix this later (bubble text alignment workaround; revisit)
                .multilineTextAlignment(.leading)
                .frame(width: bubbleWidth(), alignment: .leading)
                .padding(7)
                .background { RoundedRectangle(cornerRadius: 8).stroke("#8A8A8A", lineWidth: 1) }
                .opacity(tamaAge() > showSeconds() / 2 ? 0.5 : 1.0)
            Text("     ╲").font(.system(size: 11, design: .monospaced)).foregroundColor("#8A8A8A")
        }
        HStack(alignment: .bottom, spacing: 8) {
            sprite(clock.second)
            VStack(alignment: .leading, spacing: 1) {
                Text(petName()).font(.system(size: 12)).bold()
                Text("★ lv 1").font(.system(size: 9, design: .monospaced)).foregroundColor("#E0AF68")
                if hasComment() {
                    Text(agoLabel(tamaAge())).font(.system(size: 9)).foregroundColor(.tertiary)
                }
            }
            Spacer()
        }
    }
    .padding(8)
    .frame(height: footerHeight(), alignment: .bottom)
}
