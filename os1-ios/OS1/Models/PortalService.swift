import Foundation

/// A service the session exposes on a port: its dev server, a docs site, a
/// dashboard it brought up. The web calls the surface Portals; the wire calls
/// it preview status, and `GET /api/sessions/:id/preview` answers the same
/// shape for a host worktree, a sandbox, and a Runner.
///
/// Decoded tolerantly, like every other model here: the server adds fields,
/// and an older build must keep rendering the rows it does understand.
/// `state` in particular arrives absent from servers that predate it, and can
/// gain values this build has never heard of.
struct PortalService: Decodable, Sendable, Hashable, Identifiable {
    /// What the repository calls it, or a friendly name derived from the key.
    let name: String
    /// The `.ports.conf` key. Stable, so it is the row's identity.
    let key: String
    let port: Int
    let running: Bool
    /// The authenticated HTTPS URL, present only while something is listening.
    let previewUrl: String?
    let description: String?
    /// Where in the app to land instead of its root.
    let defaultPath: String?
    let state: PortalState?

    var id: String { key }

    private enum CodingKeys: String, CodingKey {
        case name, key, port, running, previewUrl, description, defaultPath, state
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        key = try container.decode(String.self, forKey: .key)
        name = (try? container.decode(String.self, forKey: .name)) ?? key
        port = (try? container.decode(Int.self, forKey: .port)) ?? 0
        running = (try? container.decode(Bool.self, forKey: .running)) ?? false
        previewUrl = (try? container.decodeIfPresent(String.self, forKey: .previewUrl)) ?? nil
        description = (try? container.decodeIfPresent(String.self, forKey: .description)) ?? nil
        defaultPath = (try? container.decodeIfPresent(String.self, forKey: .defaultPath)) ?? nil
        state = (try? container.decodeIfPresent(PortalState.self, forKey: .state)) ?? nil
    }

    /// For tests and previews.
    init(
        name: String,
        key: String,
        port: Int,
        running: Bool,
        previewUrl: String? = nil,
        description: String? = nil,
        defaultPath: String? = nil,
        state: PortalState? = nil
    ) {
        self.name = name
        self.key = key
        self.port = port
        self.running = running
        self.previewUrl = previewUrl
        self.description = description
        self.defaultPath = defaultPath
        self.state = state
    }

    /// What tapping the row opens, or nil when there is nothing live behind
    /// it. A sleeping sandbox deliberately reports no URL: the server drops it
    /// from the sleeping view so that reading the list can never wake compute,
    /// and this app never asks it to.
    var openURL: URL? {
        guard running, let previewUrl, let base = URL(string: previewUrl) else { return nil }
        guard let defaultPath, !defaultPath.isEmpty else { return base }
        let path = defaultPath.hasPrefix("/") ? defaultPath : "/" + defaultPath
        return URL(string: path, relativeTo: base)?.absoluteURL ?? base
    }

    /// The one word the row shows for where this service is right now.
    var display: PortalDisplayState {
        // Openable beats everything else: whatever the lifecycle says, a
        // service answering on a URL is one you can look at.
        if openURL != nil { return .live }
        switch state {
        case .sleeping: return .sleeping
        case .waking: return .waking
        case .starting: return .starting
        case .failed: return .failed
        case .awake, .stopped, .unknown, .none: return running ? .unavailable : .stopped
        }
    }
}

/// The supervisor's lifecycle for a managed portal. An unknown value decodes
/// rather than throws, so a server that grows a state does not blank the list.
enum PortalState: String, Decodable, Sendable {
    case starting
    case awake
    case sleeping
    case waking
    case failed
    case stopped
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = PortalState(rawValue: raw) ?? .unknown
    }
}

/// What a row says, kept apart from how it draws so the mapping can be tested
/// without a view.
enum PortalDisplayState: Sendable, Hashable {
    /// Listening, with a URL to open.
    case live
    case starting
    case waking
    /// The sandbox is asleep. Its portals come back when it wakes, and nothing
    /// on this screen wakes it.
    case sleeping
    case failed
    case stopped
    /// Listening, but with nothing this app can open: a Runner portal whose
    /// authenticated route was never registered, for instance.
    case unavailable

    var label: String {
        switch self {
        case .live: "Live"
        case .starting: "Starting"
        case .waking: "Waking"
        case .sleeping: "Sleeping"
        case .failed: "Failed"
        case .stopped: "Stopped"
        case .unavailable: "Unavailable"
        }
    }
}

/// `GET /api/sessions/:id/preview`, of which this app reads the services.
///
/// The recipes, the start and stop controls and the supervised lifecycle stay
/// on the desktop. This surface is for seeing what a session put up, and
/// looking at it.
struct PortalStatus: Decodable, Sendable {
    let services: [PortalService]
    /// The dev server is being brought up and its ports are not listening yet.
    let starting: Bool

    private enum CodingKeys: String, CodingKey { case services, starting }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        services = ((try? container.decodeIfPresent([PortalService].self, forKey: .services)) ?? nil) ?? []
        starting = (try? container.decode(Bool.self, forKey: .starting)) ?? false
    }

    init(services: [PortalService], starting: Bool = false) {
        self.services = services
        self.starting = starting
    }

    /// What the web panel counts in its heading.
    var liveCount: Int { services.filter { $0.openURL != nil }.count }
}
