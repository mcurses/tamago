import Foundation

/// What the daemon reports at GET /state (see daemon/server.mjs).
struct DaemonState: Decodable, Equatable, Sendable {
    struct Pet: Decodable, Equatable, Sendable {
        var species: String
        var name: String
    }

    struct Bubble: Decodable, Equatable, Sendable {
        var at: Double // epoch milliseconds; 0 = no comment yet
        var mood: String
        var about: String
        var text: String
        var action: String? // a stage direction like "bristles its spines", now and then
    }

    /// Per-workspace details the stock sidebar shows (daemon/details.mjs). Optional, so an older
    /// daemon still decodes.
    struct Workspace: Decodable, Equatable, Sendable {
        struct Status: Decodable, Equatable, Sendable {
            var key: String
            var label: String
            var value: String
            var icon: String?
            var color: String?
        }

        struct Progress: Decodable, Equatable, Sendable {
            var value: Double
            var label: String
        }

        struct Log: Decodable, Equatable, Sendable {
            var level: String
            var text: String
        }

        struct Link: Decodable, Equatable, Sendable {
            var url: String
            var label: String
        }

        struct Remote: Decodable, Equatable, Sendable {
            var target: String
            var state: String?
        }

        var color: String?
        var description: String?
        var path: String?
        var branch: String?
        var dirty: Bool?
        var prs: [Link]?
        var ports: [Int]?
        var notification: String?
        var remote: Remote?
        var statuses: [Status]?
        var progress: Progress?
        var logs: [Log]?
        var claudeSessions: Int? // interactive Claude Code sessions running in this workspace
    }

    /// Tamago's own settings, for what cmux's Settings don't cover.
    struct TamagoSettings: Decodable, Equatable, Sendable {
        var claudeDots = true
    }

    /// cmux's own sidebar settings (Settings → Sidebar), read by the daemon.
    struct Settings: Decodable, Equatable, Sendable {
        var hideAllDetails = false
        var showWorkspaceDescription = true
        var showNotificationMessage = true
        var notificationMessageLineLimit = 12
        var showBranchDirectory = true
        var showGitBranch = true
        var showGitBranchIcon = true
        var stackBranchDirectory = false
        var pathLastSegmentOnly = false
        var showPullRequests = true
        var makePullRequestsClickable = true
        var showPorts = true
        var showSSH = true
        var showLog = true
        var showProgress = true
        var showStatusPills = true
        var showAgentActivity = true
    }

    struct Mood: Decodable, Equatable, Sendable {
        var name: String // "happy", "grumpy", … (daemon/mood.mjs moodName)
        var eye: String // the sprite expression when Tama isn't talking
        var valence: Double
        var energy: Double
    }

    /// The last feed / pet / poke and how Tama took it ("love", "meh", "hate").
    struct Reaction: Decodable, Equatable, Sendable {
        var kind: String
        var response: String
        var at: Double // epoch milliseconds; 0 = never
    }

    var pet: Pet
    var bubble: Bubble
    var mood: Mood? // optional: older daemons don't send these
    var reaction: Reaction?
    var settings: Settings?
    var tamagoSettings: TamagoSettings?
    var workspaces: [String: Workspace]
}

/// Talks to the daemon on 127.0.0.1. URL and token are baked into Info.plist by
/// scripts/build-extension.sh, since the sandboxed extension can't read the daemon's files.
struct DaemonClient: Sendable {
    let base: URL
    let token: String

    init() {
        let info = Bundle.main.infoDictionary ?? [:]
        base = URL(string: info["TamagoDaemonURL"] as? String ?? "http://127.0.0.1:47321")!
        token = info["TamagoToken"] as? String ?? ""
    }

    func state() async throws -> DaemonState {
        let data = try await send(URLRequest(url: base.appendingPathComponent("state")))
        return try JSONDecoder().decode(DaemonState.self, from: data)
    }

    func action(_ body: [String: String]) async throws {
        var request = URLRequest(url: base.appendingPathComponent("action"))
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await send(request)
    }

    private func send(_ request: URLRequest) async throws -> Data {
        var request = request
        request.setValue(token, forHTTPHeaderField: "X-Tamago-Token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 3
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }
}
