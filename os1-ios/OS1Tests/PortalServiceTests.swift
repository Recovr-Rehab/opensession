import XCTest
@testable import OS1

final class PortalServiceTests: XCTestCase {
    private func decode(_ json: String) throws -> PortalStatus {
        try JSONDecoder().decode(PortalStatus.self, from: Data(json.utf8))
    }

    func testDecodesTheHostPreviewShape() throws {
        let status = try decode("""
        {"hasPortsConf":true,"webappPort":3000,"running":true,"starting":false,
         "previewUrl":"https://host:8443","bootable":true,"portalRecipes":[],
         "services":[{"name":"Webapp","key":"WEBAPP_PORT","port":3000,
                      "running":true,"pids":[42],
                      "previewUrl":"https://host:8443"}]}
        """)
        XCTAssertEqual(status.services.count, 1)
        XCTAssertEqual(status.liveCount, 1)
        let service = try XCTUnwrap(status.services.first)
        XCTAssertEqual(service.name, "Webapp")
        XCTAssertEqual(service.port, 3000)
        XCTAssertEqual(service.display, .live)
        XCTAssertEqual(service.openURL?.absoluteString, "https://host:8443")
    }

    /// A field this build has never seen must not blank the row, and neither
    /// must a lifecycle value the server grew after this build shipped.
    func testUnknownStateAndUnknownFieldsSurvive() throws {
        let status = try decode("""
        {"services":[{"name":"Docs","key":"DOCS_PORT","port":4000,
                      "running":true,"pids":[],"state":"hibernating",
                      "somethingNew":{"a":1}}]}
        """)
        let service = try XCTUnwrap(status.services.first)
        XCTAssertEqual(service.state, .unknown)
        // Running with no URL to open: honest rather than clickable.
        XCTAssertEqual(service.display, .unavailable)
        XCTAssertNil(service.openURL)
    }

    func testMissingServicesDecodesAsEmpty() throws {
        XCTAssertTrue(try decode("{\"starting\":true}").services.isEmpty)
        XCTAssertTrue(try decode("{\"starting\":true}").starting)
    }

    /// The sleeping-sandbox snapshot: metadata only, deliberately URL-less so
    /// that looking at the list cannot wake compute.
    func testSleepingSandboxPortalIsListedButNotOpenable() throws {
        let status = try decode("""
        {"hasPortsConf":true,"running":false,"starting":false,"previewUrl":null,
         "services":[{"name":"Webapp","key":"WEBAPP_PORT","port":3000,
                      "running":false,"previewUrl":null,"pids":[],
                      "state":"sleeping","managed":true}]}
        """)
        let service = try XCTUnwrap(status.services.first)
        XCTAssertEqual(service.display, .sleeping)
        XCTAssertEqual(service.display.label, "Sleeping")
        XCTAssertNil(service.openURL)
        XCTAssertEqual(status.liveCount, 0)
    }

    func testStoppedAndFailedAreDistinguished() {
        let stopped = PortalService(
            name: "Webapp", key: "WEBAPP_PORT", port: 3000, running: false
        )
        XCTAssertEqual(stopped.display, .stopped)
        let failed = PortalService(
            name: "Webapp", key: "WEBAPP_PORT", port: 3000, running: false,
            state: .failed
        )
        XCTAssertEqual(failed.display, .failed)
        let starting = PortalService(
            name: "Webapp", key: "WEBAPP_PORT", port: 3000, running: false,
            state: .starting
        )
        XCTAssertEqual(starting.display, .starting)
    }

    /// `defaultPath` lands people where the app actually begins, the same way
    /// the web's `portalTargetFor` resolves it, with or without its slash.
    func testDefaultPathIsResolvedAgainstThePortalRoot() {
        let rooted = PortalService(
            name: "Docs", key: "DOCS_PORT", port: 4000, running: true,
            previewUrl: "https://host:8443", defaultPath: "/docs/intro"
        )
        XCTAssertEqual(rooted.openURL?.absoluteString, "https://host:8443/docs/intro")

        let bare = PortalService(
            name: "Docs", key: "DOCS_PORT", port: 4000, running: true,
            previewUrl: "https://host:8443", defaultPath: "docs/intro"
        )
        XCTAssertEqual(bare.openURL?.absoluteString, "https://host:8443/docs/intro")
    }

    func testNotRunningNeverProducesAURL() {
        let service = PortalService(
            name: "Webapp", key: "WEBAPP_PORT", port: 3000, running: false,
            previewUrl: "https://host:8443", state: .stopped
        )
        XCTAssertNil(service.openURL)
    }
}
