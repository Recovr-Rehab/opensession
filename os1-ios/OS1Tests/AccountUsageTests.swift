import XCTest
@testable import OS1

/// The Usage page reduces three or four limits per account to the one that
/// decides anything. Getting that wrong is invisible in a screenshot — a wrong
/// window still draws a plausible bar — so the rule is tested rather than
/// eyeballed.
final class AccountUsageTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func window(_ label: String, _ utilization: Double?, resets: TimeInterval? = nil, scoped: Bool = false) -> LimitWindow {
        LimitWindow(
            label: label,
            utilization: utilization,
            resetsAt: resets.map { ISO8601DateFormatter().string(from: now.addingTimeInterval($0)) },
            scoped: scoped
        )
    }

    func testBindingLimitPicksTheFullestWindow() {
        let binding = AccountUsageReading.bindingLimit(
            [window("5h", 12), window("7d", 84), window("Fable", 40, scoped: true)],
            now: now
        )
        XCTAssertEqual(binding?.label, "7d")
        XCTAssertEqual(binding?.utilization, 84)
    }

    /// "Unknown" and "nothing used" are different states: a token that cannot
    /// read usage must not read as an empty account.
    func testWindowsWithoutANumberAreSkippedRatherThanReadAsEmpty() {
        let binding = AccountUsageReading.bindingLimit(
            [window("5h", nil), window("7d", 3)],
            now: now
        )
        XCTAssertEqual(binding?.label, "7d")
        XCTAssertNil(AccountUsageReading.bindingLimit([window("5h", nil)], now: now))
    }

    /// A scoped cap sidelines the account for one model specifically, so it
    /// wins a tie against an account-wide window.
    func testAScopedLimitWinsATie() {
        let binding = AccountUsageReading.bindingLimit(
            [window("7d", 50), window("Fable", 50, scoped: true)],
            now: now
        )
        XCTAssertEqual(binding?.label, "Fable")
    }

    /// A window whose reset has already passed is provably stale. Counting it
    /// at its last value would pin a just-reset account at 100% until the next
    /// poll.
    func testAPassedResetCountsAsEmpty() {
        let stale = window("5h", 100, resets: -60)
        XCTAssertEqual(AccountUsageReading.liveUtilization(stale, now: now), 0)

        let binding = AccountUsageReading.bindingLimit([stale, window("7d", 20)], now: now)
        XCTAssertEqual(binding?.label, "7d")
    }

    /// Utilization arrives as 0-100, the same scale the web meter takes.
    /// Reading it as a fraction printed every busy account as "10000%".
    func testUtilizationIsAPercentageNotAFraction() {
        XCTAssertEqual(AccountUsageReading.percentLabel(98), "98%")
        XCTAssertEqual(AccountUsageReading.fraction(98), 0.98, accuracy: 0.0001)
        XCTAssertEqual(AccountUsageReading.fraction(140), 1, accuracy: 0.0001)
        XCTAssertEqual(AccountUsageReading.fraction(nil), 0, accuracy: 0.0001)
    }

    func testColourOnlyMeansRunningOut() {
        XCTAssertFalse(AccountUsageReading.isWarning(69))
        XCTAssertTrue(AccountUsageReading.isWarning(70))
        XCTAssertFalse(AccountUsageReading.isNearLimit(89))
        XCTAssertTrue(AccountUsageReading.isNearLimit(90))
    }

    /// What a person wants from a limit is how long until it frees up.
    func testResetReadsAsTimeRemaining() {
        XCTAssertEqual(AccountUsageReading.formatReset(iso(now.addingTimeInterval(1800)), now: now), "resets in 30m")
        XCTAssertEqual(AccountUsageReading.formatReset(iso(now.addingTimeInterval(7200)), now: now), "resets in 2h")
        XCTAssertEqual(AccountUsageReading.formatReset(iso(now.addingTimeInterval(86400 * 3)), now: now), "resets in 3d")
        XCTAssertEqual(AccountUsageReading.formatReset(iso(now.addingTimeInterval(-60)), now: now), "resets now")
        XCTAssertNil(AccountUsageReading.formatReset(nil, now: now))
    }

    func testClaudeLimitsCarryTheRollingWindowsAndTheScopedCaps() {
        let usage = AccountUsage(
            fiveHour: UsageWindow(utilization: 10, resetsAt: nil),
            sevenDay: UsageWindow(utilization: 20, resetsAt: nil),
            scopedLimits: [ScopedUsageLimit(label: "Fable", utilization: 30, resetsAt: nil)]
        )
        let limits = AccountUsageReading.claudeLimits(usage)
        XCTAssertEqual(limits.map(\.label), ["5h", "7d", "Fable"])
        XCTAssertEqual(limits.filter(\.scoped).map(\.label), ["Fable"])
    }

    /// A Codex bucket names its window, so a full one says which model it holds
    /// up rather than just "primary".
    func testCodexLimitsAreNamedForTheirBucket() {
        let usage = AccountUsage(
            buckets: [
                CodexUsageBucket(
                    id: "gpt",
                    label: "GPT-5.6",
                    primary: UsageWindow(utilization: 40, resetsAt: nil),
                    secondary: UsageWindow(utilization: 90, resetsAt: nil)
                )
            ]
        )
        let limits = AccountUsageReading.codexLimits(usage)
        XCTAssertEqual(limits.map(\.label), ["GPT-5.6", "GPT-5.6"])
        XCTAssertEqual(AccountUsageReading.bindingLimit(limits, now: now)?.utilization, 90)
    }

    /// Every field is optional, as everywhere else in this client: a server
    /// that reports a shape this build has never seen still decodes.
    func testUsageDecodesFromAPartialPayload() throws {
        let json = Data(#"{"fetchedAt":"2026-08-16T10:00:00Z","fiveHour":{"utilization":42}}"#.utf8)
        let usage = try JSONDecoder().decode(AccountUsage.self, from: json)
        XCTAssertEqual(usage.fiveHour?.utilization, 42)
        XCTAssertNil(usage.sevenDay)
        XCTAssertNil(usage.buckets)
    }

    private func iso(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }
}
