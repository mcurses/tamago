// Renders Tama's footer offscreen at fixed moments of each feed / pet / poke animation into one
// contact sheet, so the compiled sidebar's drawing can be checked without cmux.
//
//   scripts/render-pet.sh [out.png]

import AppKit
import SwiftUI

struct Scenario {
    var label: String
    var species: String
    var mood: String
    var kind: String
    var response: String
    var bubble: String? = nil
}

let scenarios = [
    Scenario(label: "ghost, idle", species: "ghost", mood: "meh", kind: "-", response: "-",
             bubble: "Tests went red mid-turn, then green again. Like a séance."),
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
        "pet": ["species": s.species, "name": "Soup"],
        "bubble": ["at": s.bubble == nil ? 0 : reactionAt - 30_000, "mood": "smug", "about": "rev1", "text": s.bubble ?? "-"],
        "mood": ["name": s.mood, "eye": eye, "valence": 0, "energy": 0.5, "fullness": 0.6, "hungry": false, "eats": s.species != "ghost"],
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

@main
struct RenderPet {
    @MainActor static func main() {
    let out = CommandLine.arguments.dropFirst().first ?? "pet-sheet.png"
    let renderer = ImageRenderer(content: sheet())
    renderer.scale = 2
    guard let image = renderer.cgImage,
          let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        fatalError("render failed")
    }
    try! png.write(to: URL(fileURLWithPath: out))
    print("wrote \(out) (\(image.width)x\(image.height))")
    }
}
