import Foundation

/// Tama's look for one animation tick: the egg, or one of the /buddy species from species.json.
/// Same rules as the interpreted sidebar (sidebar/tamago.swift).
struct Pet {
    static let showSeconds = 1200.0 // how long a comment stays
    static let talkSeconds = 6.0 // how long Tama "talks" after a new comment

    /// species name -> 3 frames x 5 lines, "{E}" marking the eyes.
    static let art: [String: [[String]]] = {
        struct File: Decodable { var species: [String: [[String]]] }
        guard let url = Bundle.main.url(forResource: "species", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data) else { return [:] }
        return file.species
    }()

    static var speciesNames: [String] { ["egg"] + art.keys.sorted() }

    var species: String
    var mood: String
    var talking: Bool

    init(state: DaemonState?, now: Date) {
        let bubble = state?.bubble
        let age = bubble.map { now.timeIntervalSince1970 - $0.at / 1000 } ?? .infinity
        let hasComment = (bubble?.at ?? 0) > 0 && age < Self.showSeconds
        species = state?.pet.species ?? "egg"
        mood = hasComment ? (bubble?.mood ?? "idle") : "idle"
        talking = hasComment && age < Self.talkSeconds
    }

    func lines(tick t: Int) -> [String] {
        guard let frames = Self.art[species], frames.count == 3 else { return egg(t) }
        // The original 15-tick cycle: fidget at 4, blink at 8, fidget at 11; talking flips frames.
        let frame = talking ? t % 2 + 1 : (t % 15 == 4 ? 1 : t % 15 == 11 ? 2 : 0)
        let eye = buddyEye(t)
        return frames[frame].map { $0.replacingOccurrences(of: "{E}", with: eye) }
    }

    private func buddyEye(_ t: Int) -> String {
        if mood == "sleepy" || (!talking && t % 15 == 8) { return "-" }
        switch mood {
        case "shock": return "◉"
        case "happy": return "✦"
        case "sad": return "×"
        case "smug": return "°"
        default: return "·"
        }
    }

    private func egg(_ t: Int) -> [String] {
        let bob = t % 4 == 1 ? " " : ""
        let eyes: String = {
            if mood == "sleepy" || t % 9 == 8 { return "-  -" }
            switch mood {
            case "shock": return "O  O"
            case "happy": return "^  ^"
            case "smug": return "¬  ¬"
            case "sad": return "T  T"
            default: return "°  °"
            }
        }()
        let mouth: String = {
            if talking { return t % 2 == 0 ? "o " : "- " }
            switch mood {
            case "shock": return "O "
            case "sad": return "n "
            case "sleepy": return "~ "
            default: return "ω "
            }
        }()
        return [
            bob + (mood == "sleepy" ? "   .--. z " : "   .--.   "),
            bob + "  /    \\  ",
            bob + " | " + eyes + " | ",
            bob + " |  " + mouth + "  | ",
            bob + "  \\____/  ",
            t % 2 == 0 ? "   ^  ^   " : "   ^   ^  ",
        ]
    }
}
