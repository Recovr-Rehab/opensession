import XCTest
@testable import OS1

final class WorktreeInfoTests: XCTestCase {
    func testSessionDecodesAttachedRepos() throws {
        let session = try JSONDecoder().decode(
            Session.self,
            from: Data(
                #"{"id":"bks-1","attachedRepos":[{"repo":"infra","branch":"feature","dir":"/tmp/infra"}]}"#.utf8
            )
        )

        XCTAssertEqual(session.attachedRepos?.first?.repo, "infra")
        XCTAssertEqual(session.attachedRepos?.first?.branch, "feature")
    }

    func testWorktreeDiffIgnoresRawPatch() throws {
        let response = try JSONDecoder().decode(
            OS1API.SessionDiffResponse.self,
            from: Data(
                #"{"repos":[{"repo":"backstage","dir":"/tmp/worktree","primary":true,"diff":{"branch":"feature","baseRef":"abc","files":[{"path":"OS1/App.swift","status":"modified","additions":4,"deletions":1}],"totalAdditions":4,"totalDeletions":1,"rawPatch":"large patch omitted by native model"}}]}"#.utf8
            )
        )

        XCTAssertEqual(response.repos.first?.diff.files.first?.path, "OS1/App.swift")
        XCTAssertEqual(response.repos.first?.diff.totalAdditions, 4)
    }

    func testSessionDecodesSandboxReference() throws {
        let session = try JSONDecoder().decode(
            Session.self,
            from: Data(
                #"{"id":"bks-1","sandbox":{"provider":"daytona","sandboxId":"sbx-1","workspace":"volume"}}"#.utf8
            )
        )

        XCTAssertEqual(session.sandbox?.provider, "daytona")
        XCTAssertEqual(session.sandbox?.sandboxId, "sbx-1")
        XCTAssertEqual(session.sandbox?.workspace, "volume")
    }

    func testSandboxStatusToleratesMissingAndNewFields() throws {
        let status = try JSONDecoder().decode(
            SessionSandboxStatus.self,
            from: Data(#"{"enabled":true,"provider":"daytona","status":"hibernating","futureField":true}"#.utf8)
        )

        XCTAssertEqual(status.enabled, true)
        XCTAssertEqual(status.provider, "daytona")
        XCTAssertEqual(status.status, "hibernating")
        XCTAssertNil(status.sandboxId)
        XCTAssertNil(status.canResume)
    }
}
