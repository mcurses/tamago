import Foundation

/// Tama's look for one animation tick: the egg, or one of the /buddy species from species.json.
/// Sprites from sidebar/species.json, with mood and feed/pet/poke reactions.
struct Pet {
    static let showSeconds = 1200.0 // how long a comment stays
    static let talkSeconds = 6.0 // how long Tama "talks" after a new comment
    static let reactSeconds = 2.6 // how long a feed / pet / poke animation runs

    /// species name -> 3 frames x 5 lines, "{E}" marking the eyes.
    static let art: [String: [[String]]] = {
        struct File: Decodable { var species: [String: [[String]]] }
        guard let url = Bundle.main.url(forResource: "species", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data) else { return [:] }
        return file.species
    }()

    static var speciesNames: [String] { ["egg"] + art.keys.sorted() }

    /// A running feed / pet / poke animation; `progress` goes 0 … 1.
    struct Reaction {
        var kind: String // feed, pet, poke
        var response: String // love, meh, hate
        var progress: Double
    }

    var species: String
    var mood: String
    var talking: Bool
    var reaction: Reaction?

    init(state: DaemonState?, now: Date) {
        let seconds = now.timeIntervalSince1970
        let bubble = state?.bubble
        let age = bubble.map { seconds - $0.at / 1000 } ?? .infinity
        let hasComment = (bubble?.at ?? 0) > 0 && age < Self.showSeconds
        species = state?.pet.species ?? "egg"
        // A comment's expression while it is fresh, otherwise the mood's.
        mood = hasComment && age < Self.talkSeconds * 10 ? (bubble?.mood ?? "idle") : (state?.mood?.eye ?? "idle")
        talking = hasComment && age < Self.talkSeconds
        if let r = state?.reaction, r.at > 0 {
            let p = (seconds - r.at / 1000) / Self.reactSeconds
            if p >= 0, p < 1 { reaction = Reaction(kind: r.kind, response: r.response, progress: p) }
        }
    }

    /// `t` is in fifths of a second, so reactions can move faster than the 1 s idle cycle.
    func lines(fifths t: Int) -> [String] {
        let s = t / 5
        guard let frames = Self.art[species], frames.count == 3 else { return egg(s, fast: t) }
        let frame: Int
        if chewing { frame = t % 2 + 1 }
        else if talking { frame = s % 2 + 1 }
        else { frame = s % 15 == 4 ? 1 : s % 15 == 11 ? 2 : 0 } // fidget at 4, blink at 8, fidget at 11
        let eye = reactionFace?.buddy ?? buddyEye(s)
        return frames[frame].map { $0.replacingOccurrences(of: "{E}", with: eye) }
    }

    /// Eating, between the snack arriving and the verdict.
    private var chewing: Bool {
        guard let r = reaction, r.kind == "feed", r.response != "hate" else { return false }
        return r.progress > 0.3 && r.progress < 0.6
    }

    /// The face during a reaction: startled by a poke first, then love / meh / hate.
    private var reactionFace: (buddy: String, egg: String)? {
        guard let r = reaction else { return nil }
        if r.kind == "poke" && r.progress < 0.25 { return ("◉", "O  O") }
        if r.kind == "feed" && r.progress < 0.3 { return ("°", "°  °") }
        switch r.response {
        case "love": return ("^", "^  ^")
        case "hate": return ("×", "×  ×")
        default: return ("-", "-  -")
        }
    }

    private func buddyEye(_ t: Int) -> String {
        if mood == "sleepy" || (!talking && t % 15 == 8) { return "-" }
        switch mood {
        case "shock": return "◉"
        case "happy": return "✦"
        case "sad": return "×"
        case "smug": return "°"
        case "grumpy": return "¬"
        default: return "·"
        }
    }

    private func egg(_ t: Int, fast: Int) -> [String] {
        let bob = t % 4 == 1 ? " " : ""
        let eyes: String = {
            if let face = reactionFace { return face.egg }
            if mood == "sleepy" || t % 9 == 8 { return "-  -" }
            switch mood {
            case "shock": return "O  O"
            case "happy": return "^  ^"
            case "smug": return "¬  ¬"
            case "sad": return "T  T"
            case "grumpy": return "ò  ó"
            default: return "°  °"
            }
        }()
        let mouth: String = {
            if chewing { return fast % 2 == 0 ? "o " : "- " }
            if talking { return t % 2 == 0 ? "o " : "- " }
            switch mood {
            case "shock": return "O "
            case "sad", "grumpy": return "n "
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
