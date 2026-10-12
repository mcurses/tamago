// Renders Tama's footer offscreen at fixed moments of each feed / pet / poke animation into one
// contact sheet, so the compiled sidebar's drawing can be checked without cmux.
//
//   scripts/render-pet.sh [out.png]

import AppKit
import CmuxExtensionKit
import SwiftUI

struct Scenario {
    var label: String
    var species: String
    var mood: String
    var kind: String
    var response: String
    var bubble: String? = nil
    var name = "Soup"
    var bubbleAge: Double? = nil // seconds; nil = no comment yet (a bubble text implies 30 s)
}

let scenarios = [
    Scenario(label: "ghost, idle", species: "ghost", mood: "meh", kind: "-", response: "-",
             bubble: "Tests went red mid-turn, then green again. Like a séance."),
    Scenario(label: "long name", species: "ghost", mood: "meh", kind: "-", response: "-",
             name: "Sir Reginald Fluffington", bubbleAge: 3 * 3600),
    Scenario(label: "duck, 12m", species: "duck", mood: "ecstatic", kind: "-", response: "-", bubbleAge: 720),
    Scenario(label: "feed / love", species: "chonk", mood: "happy", kind: "feed", response: "love"),
    Scenario(label: "feed / hate", species: "cactus", mood: "grumpy", kind: "feed", response: "hate"),
    Scenario(label: "pet / love", species: "cat", mood: "content", kind: "pet", response: "love"),
    Scenario(label: "pet / hate", species: "goose", mood: "furious", kind: "pet", response: "hate"),
    Scenario(label: "poke / love", species: "ghost", mood: "meh", kind: "poke", response: "love"),
    Scenario(label: "poke / meh", species: "robot", mood: "meh", kind: "poke", response: "meh"),
    Scenario(label: "poke / hate", species: "egg", mood: "grumpy", kind: "poke", response: "hate"),
]
let moments = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]

func state(_ s: Scenario, reactionAt: Double) -> DaemonState {
    let eye = ["happy": "happy", "content": "smug", "grumpy": "grumpy", "furious": "sad"][s.mood] ?? "idle"
    let json: [String: Any] = [
        "pet": ["species": s.species, "name": s.name],
        "bubble": ["at": s.bubble == nil && s.bubbleAge == nil ? 0 : reactionAt - (s.bubbleAge ?? 30) * 1000, "mood": "smug", "about": "rev1", "text": s.bubble ?? "-"],
        "mood": ["name": s.mood, "eye": eye, "valence": 0, "energy": 0.5],
        "reaction": ["kind": s.kind, "response": s.response, "at": s.kind == "-" ? 0 : reactionAt],
        "workspaces": [String: Any](),
    ]
    return try! JSONDecoder().decode(DaemonState.self, from: JSONSerialization.data(withJSONObject: json))
}

@MainActor func sheet() -> some View {
    let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    let ms = t0.timeIntervalSince1970 * 1000
    return VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(scenarios.enumerated()), id: \.offset) { _, s in
            let model = SidebarModel(preview: state(s, reactionAt: ms))
            HStack(alignment: .bottom, spacing: 4) {
                Text(s.label).font(.system(size: 10, design: .monospaced)).frame(width: 80, alignment: .leading)
                ForEach(moments, id: \.self) { p in
                    VStack(spacing: 0) {
                        PetFooter(model: model, frozenAt: t0.addingTimeInterval(p * Pet.reactSeconds))
                            .frame(width: 240)
                            .border(Color.gray.opacity(0.3))
                        Text(String(format: "p=%.2f", p)).font(.system(size: 9)).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
    .padding(10)
    .background(Color(hex: "#1E1E1E")!)
    .environment(\.colorScheme, .dark)
}

// MARK: workspace rows

let rowWorkspaces: [(CmuxSidebarWorkspace, [String: Any])] = [
    (CmuxSidebarWorkspace(id: UUID(), title: "tamago", isPinned: true, gitBranch: "main", unreadCount: 2), [
        "path": "~/code/tamago", "branch": "main", "dirty": true,
        "statuses": [["key": "claude_code", "label": "Claude Code", "value": "Running", "icon": "bolt.fill", "color": "#4C8DFF"]],
        "notification": "Claude is waiting for your input",
        "ports": [5193, 8765], "prs": [["url": "https://github.com/mcurses/tamago/pull/12", "label": "PR #12"]],
    ]),
    (CmuxSidebarWorkspace(id: UUID(), title: "emma_rev1 coordinator with a long title that truncates"), [
        "path": "~/code/emma_rev1/very/deep/project/directory/structure", "branch": "slice/0517-author-window",
        "statuses": [["key": "claude_code", "label": "Claude Code", "value": "Needs input", "icon": "bell.fill", "color": "#4C8DFF"]],
        "progress": ["value": 0.4, "label": "Building 4/10"],
        "logs": [["level": "warning", "text": "disk almost full"], ["level": "success", "text": "deploy done"]],
        "remote": ["target": "VS7679", "state": "connected"], "description": "Pilot box driver work",
    ]),
    (CmuxSidebarWorkspace(id: UUID(), title: "portfolio"), ["path": "~/code/portfolio", "ports": [4321]]),
]

func settingsJSON(_ allOn: Bool) -> [String: Any] {
    // "yours" = the values cmux had saved on the dev machine when this was written.
    let yours: [String: Any] = [
        "hideAllDetails": false, "showWorkspaceDescription": true, "showNotificationMessage": false,
        "notificationMessageLineLimit": 12, "showBranchDirectory": false, "showGitBranch": true,
        "showGitBranchIcon": true, "stackBranchDirectory": false, "pathLastSegmentOnly": false,
        "showPullRequests": false, "makePullRequestsClickable": true, "showPorts": false, "showSSH": false,
        "showLog": false, "showProgress": false, "showStatusPills": false, "showAgentActivity": false,
    ]
    return allOn ? yours.mapValues { ($0 as? Bool).map { _ in true as Any } ?? $0 }.merging(["hideAllDetails": false, "stackBranchDirectory": false, "pathLastSegmentOnly": false]) { $1 } : yours
}

@MainActor func rowsSheet() -> some View {
    HStack(alignment: .top, spacing: 16) {
        ForEach([true, false], id: \.self) { allOn in
            let workspaces = Dictionary(uniqueKeysWithValues: rowWorkspaces.map { ($0.0.id.uuidString, $0.1) })
            let json: [String: Any] = [
                "pet": ["species": "ghost", "name": "Soup"],
                "bubble": ["at": 0, "mood": "idle", "about": "-", "text": "-"],
                "settings": settingsJSON(allOn),
                "workspaces": workspaces,
            ]
            let state = try! JSONDecoder().decode(DaemonState.self, from: JSONSerialization.data(withJSONObject: json))
            let model = SidebarModel(preview: state)
            VStack(alignment: .leading, spacing: 1) {
                Text(allOn ? "every detail on" : "your cmux settings").font(.system(size: 10, design: .monospaced))
                ForEach(Array(rowWorkspaces.enumerated()), id: \.offset) { i, w in
                    WorkspaceRow(workspace: w.0, selected: i == 0, extra: model.extra(for: w.0.id), model: model, renaming: .constant(nil))
                }
            }
            .frame(width: 250)
            .border(Color.gray.opacity(0.3))
        }
    }
    .padding(10)
    .background(Color(hex: "#1E1E1E")!)
    .environment(\.colorScheme, .dark)
}

@MainActor func write<V: View>(_ view: V, to out: String) {
    let renderer = ImageRenderer(content: view)
    renderer.scale = 2
    guard let image = renderer.cgImage,
          let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        fatalError("render failed")
    }
    try! png.write(to: URL(fileURLWithPath: out))
    print("wrote \(out) (\(image.width)x\(image.height))")
}

@main
struct RenderPet {
    @MainActor static func main() {
        let out = CommandLine.arguments.dropFirst().first ?? "pet-sheet.png"
        write(sheet(), to: out)
        write(rowsSheet(), to: out.replacingOccurrences(of: "pet-sheet", with: "rows-sheet"))
    }
}
