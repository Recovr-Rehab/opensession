import Foundation

/// Keeps the native cache of cross-device preferences current. Views continue
/// to use AppStorage so a refresh updates existing screens immediately.
@MainActor
enum NativePreferences {
    struct Context: Equatable {
        let server: String
        let user: String
        let login: String
        fileprivate let token: String
    }

    private static var generation = 0
    private static let identityKey = "os1.preferences.identity"
    private static let bucketKey = "os1.preferences.bucket"

    static func context() -> Context {
        let config = ServerConfig.shared
        return Context(
            server: config.baseURLString,
            user: config.userName,
            login: config.githubLogin,
            token: config.token
        )
    }

    static func hydrate() async {
        let config = ServerConfig.shared
        guard config.isConfigured else { return }
        let requestContext = context()
        generation += 1
        let requestGeneration = generation
        guard let prefs = try? await SettingsAPI.uiPrefs(user: requestContext.user) else { return }
        guard requestGeneration == generation,
              context() == requestContext
        else { return }

        apply(
            prefs,
            identity: identity(for: requestContext),
            bucket: bucket(for: requestContext)
        )
    }

    @discardableResult
    static func apply(_ prefs: [String: String], for requestContext: Context) -> Bool {
        guard context() == requestContext else { return false }
        generation += 1
        apply(
            prefs,
            identity: identity(for: requestContext),
            bucket: bucket(for: requestContext)
        )
        return true
    }

    private static func apply(
        _ prefs: [String: String],
        identity: String,
        bucket: String
    ) {
        let defaults = UserDefaults.standard
        let previousIdentity = defaults.string(forKey: identityKey)
        let previousBucket = defaults.string(forKey: bucketKey)
        let changedIdentity = previousIdentity != identity || previousBucket != bucket

        set(
            prefs["default-model"],
            default: "",
            key: "os1.composer.defaultModel",
            resetMissing: changedIdentity,
            in: defaults
        )
        set(
            validated(prefs["send-key"], allowed: ["enter", "mod-enter"]),
            default: "enter",
            key: "os1.composer.sendKey",
            resetMissing: changedIdentity,
            in: defaults
        )
        set(
            validated(prefs["busy-send"], allowed: ["queue", "steer"]),
            default: "queue",
            key: "os1.composer.busySend",
            resetMissing: changedIdentity,
            in: defaults
        )
        set(
            validated(prefs["busy-send-mod"], allowed: ["queue", "steer"]),
            default: "steer",
            key: "os1.composer.busySendMod",
            resetMissing: changedIdentity,
            in: defaults
        )
        set(
            validated(prefs["turn-activity"], allowed: ["messages", "auto", "expanded", "collapsed"]),
            default: "auto",
            key: "os1.appearance.turnActivity",
            resetMissing: changedIdentity,
            in: defaults
        )
        setBool(
            replySuggestionsEnabled(prefs["reply-suggestions"]),
            default: true,
            key: "os1.composer.replySuggestions",
            resetMissing: changedIdentity,
            in: defaults
        )
        set(
            validatedIdList(prefs["repo-order"]),
            default: "[]",
            key: "os1.sidebar.repoOrder",
            resetMissing: true,
            in: defaults
        )
        // Sidebar sources the person hid, here or in the browser. Reset when
        // the pref is missing, like repo order: both are the account's, so an
        // absent value means "nothing hidden", not "keep what this device has".
        set(
            validatedIdList(prefs[SidebarFeeds.prefKey]),
            default: "[]",
            key: SidebarFeeds.storageKey,
            resetMissing: true,
            in: defaults
        )
        // Tools the person hid, here or in the browser. Same list shape as the
        // sources above, but a missing value means the shared defaults rather
        // than "nothing hidden": a tool nobody has switched on has never been
        // in the web sidebar either, and the phone showing it anyway is what
        // this pref exists to stop.
        set(
            validatedIdList(prefs[SidebarTools.prefKey]),
            default: SidebarTools.defaultHiddenJSON,
            key: SidebarTools.storageKey,
            resetMissing: true,
            in: defaults
        )
        set(
            validated(prefs["desk-voice"], allowed: ["on", "off"]),
            default: "off",
            key: "os1.desk.voice",
            resetMissing: changedIdentity,
            in: defaults
        )
        set(
            AccountShortcuts.validatedRawValue(prefs["shortcuts"]),
            default: AccountShortcuts.emptyRawValue,
            key: AccountShortcuts.storageKey,
            resetMissing: true,
            in: defaults
        )
        defaults.set(identity, forKey: identityKey)
        defaults.set(bucket, forKey: bucketKey)
    }

    private static func identity(for context: Context) -> String {
        let person = context.login.isEmpty ? "user:\(context.user)" : "github:\(context.login)"
        return "\(context.server)|\(person.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
    }

    private static func bucket(for context: Context) -> String {
        "\(context.server)|\(context.user.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
    }

    private static func validated(_ value: String?, allowed: Set<String>) -> String? {
        guard let value, allowed.contains(value) else { return nil }
        return value
    }

    /// The web stores this boolean as "on"/"off" in ui-prefs. Unknown values
    /// are ignored so a newer client cannot accidentally disable the feature.
    static func replySuggestionsEnabled(_ value: String?) -> Bool? {
        switch value {
        case "on": true
        case "off": false
        default: nil
        }
    }

    /// The shape both list-valued prefs share (repo order, hidden sources): a
    /// JSON array of ids, trimmed, blanks and duplicates dropped, order kept.
    private static func validatedIdList(_ value: String?) -> String? {
        guard let value,
              let data = value.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data)
        else { return nil }
        var seen = Set<String>()
        let normalized = ids.compactMap { id -> String? in
            let id = id.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, seen.insert(id).inserted else { return nil }
            return id
        }
        guard let encoded = try? JSONEncoder().encode(normalized) else { return nil }
        return String(decoding: encoded, as: UTF8.self)
    }

    private static func set(
        _ value: String?,
        default defaultValue: String,
        key: String,
        resetMissing: Bool,
        in defaults: UserDefaults
    ) {
        if let value {
            defaults.set(value, forKey: key)
        } else if resetMissing {
            defaults.set(defaultValue, forKey: key)
        }
    }

    private static func setBool(
        _ value: Bool?,
        default defaultValue: Bool,
        key: String,
        resetMissing: Bool,
        in defaults: UserDefaults
    ) {
        if let value {
            defaults.set(value, forKey: key)
        } else if resetMissing {
            defaults.set(defaultValue, forKey: key)
        }
    }
}
