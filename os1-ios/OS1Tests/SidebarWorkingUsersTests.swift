import XCTest
@testable import OS1

final class SidebarWorkingUsersTests: XCTestCase {
    private func session(_ user: String?, running: Bool = true) -> Session {
        var session = Session(id: UUID().uuidString)
        session.isRunning = running
        session.runBy = user
        return session
    }

    func testOnlyInFlightTeammateRunsEarnFaces() {
        XCTAssertEqual(
            Session.workingUsers(
                in: [
                    session("Michiel"),
                    session("Johnny", running: false),
                    session(nil),
                ],
                excluding: "Kent"
            ),
            ["Michiel"]
        )
    }

    func testCurrentUserAndDuplicateDevicesStayHidden() {
        XCTAssertEqual(
            Session.workingUsers(
                in: [session("Kent"), session("Michiel"), session("Michiel de Bruin")],
                excluding: "Kent de Bruin"
            ),
            ["Michiel"]
        )
    }
}
