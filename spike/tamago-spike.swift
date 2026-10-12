VStack(alignment: .leading, spacing: 6) {
    Text("Workspaces").font(.headline)
    Divider()
    ForEach(workspaces) { w in
        HStack {
            Text(w.selected ? "●" : "○").foregroundColor(w.selected ? "accent" : .secondary)
            Text(w.title).lineLimit(1)
            Spacer()
        }
        .onTapGesture { cmux("workspace.select", workspace_id: w.id) }
    }
}
.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
.safeAreaInset(edge: .bottom) {
    HStack(alignment: .top, spacing: 8) {
        VStack(alignment: .leading, spacing: 0) {
            Text(clock.second % 6 == 5 ? " (-.-) " : " (o.o) ")
            Text(clock.second % 2 == 0 ? " /|_|\ " : " \|_|/ ")
            Text(clock.second % 2 == 0 ? "  / \\  " : "  | |  ")
        }
        .font(.system(size: 11, design: .monospaced))
        VStack(alignment: .leading, spacing: 2) {
            Text("Pip").font(.caption).bold()
            ForEach(workspaces) { w in
                if w.selected {
                    if let p = w.progress { Text(p.label).font(.caption).lineLimit(4) }
                }
            }
        }
        Spacer()
    }
    .padding(8)
    .background("#00000033")
}
