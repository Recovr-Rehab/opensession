import Foundation

/// The sessions list's view controls, in the shape the web sidebar settled on
/// (`src/frontend/lib/sidebar-filter.ts`), so one account reads the same list
/// in the browser and on the phone.
///
/// Only the model lives here. The panel that sets it is
/// `Views/SessionsFilterPanel.swift`; the list that reads it is
/// `Views/SessionsListView.swift`.

/// What sits above the list's activity bands.
///
/// The list is an inbox whichever of these is picked: its rows band by what
/// they want from you and when they last moved (Needs action / Recent /
/// Yesterday / Earlier / Done). This is the one question left, and it has
/// three answers: nothing above those bands, one band per project, or the
/// status lanes, which stand in for the bands rather than nesting inside them.
///
/// Six cases became three. Two combinations went deliberately: a flat
/// "Recently active" list with no headings at all, and the status lanes nested
/// under each project, which split the one "Needs input" heading status is for
/// into one per project with a row or two under each. Scoping the list to a
/// project is how you read one project's lanes now, and it costs no nesting.
enum SidebarGroupBy: String, CaseIterable, Sendable {
    /// The inbox bands with nothing above them. Stored under the web's
    /// spelling, so the two clients read each other's value.
    case activity = "none"
    case project = "repo"
    case status

    var label: String {
        switch self {
        case .activity: "Activity"
        case .project: "Project"
        case .status: "Status"
        }
    }

    /// The grouping to use when nobody has picked one. A single project has
    /// nothing to band by, so its inbox stands on its own; several get one
    /// band each. It re-decides as projects are added, since nothing is
    /// stored until somebody picks.
    ///
    /// The count is only unknown on the very first load, before `/api/repos`
    /// answers, so assume several then: an instance that has them should not
    /// paint a flat list and re-band a moment later.
    static func fallback(repoCount: Int) -> SidebarGroupBy {
        repoCount == RepoCount.unknown || repoCount > 1 ? .project : .activity
    }

    /// What a stored value means now, including the five spellings this app
    /// used to write. Reading the old value IS the migration: the next pick
    /// writes the new spelling, and a value nobody recognises falls back to
    /// the default like an unpicked one.
    ///
    /// `repo-status` lands on Project, where the web sends the same value to
    /// Status. The two clients dropped that combination from opposite sides:
    /// on the web the status lanes were the deliberate half of the pick, while
    /// here it was the DEFAULT for every multi-project instance, so its repo
    /// bands are what people are actually looking at.
    static func stored(_ raw: String) -> SidebarGroupBy? {
        switch raw {
        case "none", "inbox", "recent": .activity
        case "repo", "repo-inbox", "repo-status": .project
        case "status": .status
        default: nil
        }
    }
}

/// What orders the rows inside every band.
enum SidebarSortBy: String, CaseIterable, Sendable {
    case updated, created

    var label: String {
        switch self {
        case .updated: "Last activity"
        case .created: "Created"
        }
    }
}

/// Whose work the list is showing.
///
/// It used to be two answers, yours and everyone's. It is now the web's lens:
/// you, any teammate, the agent (which holds the work nobody has taken), the
/// unassigned backlog, or everyone. The values are stored the way the web
/// stores them, and the two this app wrote before are read as their new
/// spelling.
enum SidebarPersonLens {
    static let me = "me"
    static let everyone = "everyone"
    static let unassigned = "unassigned"

    static let storageKey = "os1.list.people"

    /// What a stored value means now. `mine` and `all` are what this app wrote
    /// before the lens grew; anything else is already a person key.
    static func stored(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespaces).lowercased()
        switch value {
        case "", "mine": return me
        case "all": return everyone
        default: return value
        }
    }

    /// Does this free-text name (a session's `startedBy`, a workspace's
    /// `createdBy`) belong to the person the lens is on?
    ///
    /// One teammate reaches us as "Kent", "Kent de Bruin" and "kentdebruin"
    /// depending on whether the name came from a roster, a display name or a
    /// GitHub login, so the compare is the app's usual loose one: equal, or
    /// either a prefix of the other. Same rule as the web's
    /// `ownerMatchesPerson` (lib/automation-audience.ts).
    static func nameMatches(_ name: String, key: String) -> Bool {
        let a = name.trimmingCharacters(in: .whitespaces).lowercased()
        let b = key.trimmingCharacters(in: .whitespaces).lowercased()
        guard !a.isEmpty, !b.isEmpty else { return false }
        return a == b || a.hasPrefix(b) || b.hasPrefix(a)
    }
}

/// A row nobody started by hand: an agent minted this session or workspace
/// through the automation machine identity.
///
/// Not an automation. An automation is a job somebody configured, with a name,
/// a trigger and an owner, and its runs carry that name. These are one-off
/// workspaces an agent opened for itself with no automation behind them, which
/// is why they sit in the ordinary bands and need a mark at all. Mirrors the
/// web's `rowWasAutoCreated` (lib/sidebar-placement.ts).
enum AutoCreatedOrigin {
    static let machineIdentity = "automation"

    static func wasAutoCreated(_ session: Session) -> Bool {
        [session.createdBy, session.startedBy].contains { name in
            name?.trimmingCharacters(in: .whitespaces).lowercased() == machineIdentity
        }
    }

    static func wasAutoCreated(_ workspace: SidebarWorkspace) -> Bool {
        let ordinary = workspace.sessions.filter { !$0.isAutomation }
        // Once a person joins the workspace it is shared work, not machine
        // clutter: hiding the whole row would hide that person's sessions too.
        if !ordinary.isEmpty { return ordinary.allSatisfy(wasAutoCreated) }
        // An automation-only row is an automation run even when its container
        // happened to be minted by the machine identity.
        if !workspace.sessions.isEmpty { return false }
        let owner = workspace.workspace?.createdBy?
            .trimmingCharacters(in: .whitespaces).lowercased()
        return owner == machineIdentity
    }
}
