import XCTest
@testable import OS1

/// The transcript's reading rhythm: question → [folded work] → answer → meta.
/// These pin the fold boundaries, since getting them wrong either hides the
/// answer or shows every tool call raw.
@MainActor
final class TranscriptGroupingTests: XCTestCase {
    private var viewModel: SessionViewModel!

    /// No socket: these exercise the display pass, which is driven purely by
    /// the frames handed to `handle`.
    override func setUp() async throws {
        viewModel = SessionViewModel(session: Session(id: "bks-1"))
    }

    private func append(_ entries: [TranscriptEntry]) {
        viewModel.handle(.transcriptAppend(sessionId: "bks-1", entries: entries))
    }

    private func toolUse(
        _ id: String,
        name: String,
        input: [String: JSONValue] = [:]
    ) -> TranscriptEntry {
        TranscriptEntry(
            id: id,
            type: "tool_use",
            content: "Using \(name)",
            toolName: name,
            toolInput: .object(input),
            toolUseId: id
        )
    }

    private func toolResult(_ useId: String, text: String) -> TranscriptEntry {
        TranscriptEntry(
            id: "tr-\(useId)",
            type: "tool_result",
            content: text,
            toolUseId: useId
        )
    }

    // MARK: - Fold boundaries

    func testToolCallsFoldAndTheFinalAnswerEscapes() {
        append([
            TranscriptEntry(id: "u1", type: "user", content: "fix it"),
            TranscriptEntry(id: "a1", type: "assistant", content: "Looking."),
            toolUse("t1", name: "Bash", input: ["command": .string("bun test")]),
            toolResult("t1", text: "ok"),
            TranscriptEntry(
                id: "a2",
                type: "assistant",
                content: "Fixed.",
                timestamp: "2026-01-01T00:00:10Z"
            ),
        ])

        let blocks = viewModel.displayBlocks
        XCTAssertEqual(blocks.count, 3, "prompt, fold, answer — the footer needs timestamps")
        guard case .message(let prompt) = blocks[0] else {
            return XCTFail("first block should be the prompt")
        }
        XCTAssertEqual(prompt.id, "u1")

        guard case .work(let turn) = blocks[1] else {
            return XCTFail("the tool call and its narration should fold")
        }
        XCTAssertEqual(turn.toolCount, 1)
        XCTAssertEqual(turn.families, [.run])
        XCTAssertEqual(turn.items.count, 2, "narration folds with the tool call")

        guard case .message(let answer) = blocks[2] else {
            return XCTFail("the final answer must escape the fold")
        }
        XCTAssertEqual(answer.id, "a2")
    }

    func testTurnWithoutToolsDoesNotFold() {
        append([
            TranscriptEntry(id: "u1", type: "user", content: "hi"),
            TranscriptEntry(id: "a1", type: "assistant", content: "hello"),
        ])
        XCTAssertEqual(viewModel.displayBlocks.count, 2)
        for block in viewModel.displayBlocks {
            if case .work = block { XCTFail("nothing to hide, so nothing should fold") }
        }
    }

    func testTurnStillRunningFoldsEntirelyAndSkipsItsFooter() {
        viewModel.handle(.sessionStatus(sessionId: "bks-1", isRunning: true))
        append([
            TranscriptEntry(id: "u1", type: "user", content: "go"),
            TranscriptEntry(id: "a1", type: "assistant", content: "On it."),
            toolUse("t1", name: "Read", input: ["file_path": .string("/tmp/x.swift")]),
        ])

        let blocks = viewModel.displayBlocks
        XCTAssertEqual(blocks.count, 2, "a turn that ended mid-tools folds whole")
        guard case .work(let turn) = blocks[1] else {
            return XCTFail("expected a fold")
        }
        XCTAssertTrue(turn.isLive)
        XCTAssertNotNil(turn.livePreview, "a collapsed live fold must say what it is doing")
        for block in blocks {
            if case .footer = block { XCTFail("a running turn has no settled duration") }
        }
    }

    func testFooterCarriesDurationModelAndTouchedFiles() {
        append([
            TranscriptEntry(
                id: "u1",
                type: "user",
                content: "edit",
                timestamp: "2026-01-01T00:00:00Z"
            ),
            toolUse("t1", name: "Edit", input: [
                "file_path": .string("/repo/src/App.tsx"),
                "old_string": .string("a\nb"),
                "new_string": .string("a\nb\nc"),
            ]),
            toolResult("t1", text: "ok"),
            TranscriptEntry(
                id: "a1",
                type: "assistant",
                content: "Done.",
                timestamp: "2026-01-01T00:00:12Z",
                model: "opencode/anthropic/claude-sonnet-5"
            ),
        ])

        let footers = viewModel.displayBlocks.compactMap { block -> TurnFooter? in
            if case .footer(let footer) = block { return footer }
            return nil
        }
        XCTAssertEqual(footers.count, 1)
        XCTAssertEqual(footers[0].files.map(\.basename), ["App.tsx"])
        XCTAssertEqual(footers[0].model, "opencode/anthropic/claude-sonnet-5")
        XCTAssertEqual(TranscriptFormat.modelLabel(footers[0].model ?? ""), "Sonnet 5")
    }

    /// A Task row without a way into the worker is a dead end, so the id has
    /// to be found however the engine happened to report it.
    func testSubagentIdIsFoundFromTheResultField() {
        var result = toolResult("t1", text: "done")
        result.agentId = "ses_abc123"
        append([
            TranscriptEntry(id: "u1", type: "user", content: "go"),
            toolUse("t1", name: "Task", input: ["description": .string("look")]),
            result,
        ])
        XCTAssertEqual(firstToolCall()?.subagentId, "ses_abc123")
    }

    func testSubagentIdIsFoundInTheResultBody() {
        append([
            TranscriptEntry(id: "u1", type: "user", content: "go"),
            toolUse("t1", name: "Task", input: ["description": .string("look")]),
            toolResult("t1", text: "<task id=\"ses_xyz789\" state=\"completed\">…</task>"),
        ])
        XCTAssertEqual(firstToolCall()?.subagentId, "ses_xyz789")
    }

    func testNonAgentToolsNeverOfferASubagentDrillIn() {
        var result = toolResult("t1", text: "ok")
        result.agentId = "ses_abc123"
        append([
            TranscriptEntry(id: "u1", type: "user", content: "go"),
            toolUse("t1", name: "Bash", input: ["command": .string("ls")]),
            result,
        ])
        XCTAssertNil(firstToolCall()?.subagentId)
    }

    /// The first tool call in the transcript, wherever it ended up rendering.
    private func firstToolCall() -> ToolCallItem? {
        for block in viewModel.displayBlocks {
            switch block {
            case .tool(let item): return item
            case .work(let turn):
                for case .tool(let item) in turn.items { return item }
            default: continue
            }
        }
        return nil
    }

    func testAnchorSurvivesRegrouping() {
        append([
            TranscriptEntry(id: "u1", type: "user", content: "hi"),
            toolUse("t1", name: "Grep", input: ["pattern": .string("foo")]),
            toolResult("t1", text: "none"),
        ])
        // The tool call lives inside a fold whose id is not the entry's id —
        // the history-restore anchor has to resolve through the entry.
        XCTAssertNotNil(viewModel.blockId(containing: "t1"))
        XCTAssertEqual(viewModel.topmostEntryId, "u1")
    }
}

/// Tool identity: the collapsed summary line is what people read 95% of the
/// time, so its naming and truncation rules are worth pinning.
final class ToolPresentationTests: XCTestCase {
    func testEngineDialectsFoldOntoOneName() {
        for raw in ["bash", "shell", "exec_command"] {
            XCTAssertEqual(
                ToolPresentation.make(toolName: raw, input: nil).canonical,
                "Bash",
                "\(raw) should read as Bash"
            )
        }
        XCTAssertEqual(
            ToolPresentation.make(toolName: "apply_patch", input: nil).canonical,
            "Edit"
        )
    }

    func testMcpNamesSplitIntoServerAndTool() {
        let presentation = ToolPresentation.make(
            toolName: "mcp__oc__linear_list_issues",
            input: nil
        )
        XCTAssertEqual(presentation.mcpServer, "linear")
        XCTAssertEqual(presentation.name, "list_issues")
        XCTAssertEqual(presentation.family, .mcp)
        XCTAssertEqual(presentation.displayName, "linear · list_issues")
    }

    func testNativeToolsAreNotMistakenForMcpServers() {
        XCTAssertNil(ToolPresentation.make(toolName: "apply_patch", input: nil).mcpServer)
        XCTAssertNil(ToolPresentation.make(toolName: "exit_plan_mode", input: nil).mcpServer)
    }

    func testBashSummaryFlattensNewlines() {
        let presentation = ToolPresentation.make(
            toolName: "Bash",
            input: .object(["command": .string("cd src\nbun test")])
        )
        XCTAssertEqual(presentation.summary, "cd src ⏎ bun test")
        XCTAssertEqual(presentation.family, .run)
    }

    func testPathsAreRepoRelativeInsideTheWorktree() {
        let presentation = ToolPresentation.make(
            toolName: "Read",
            input: .object(["file_path": .string("/wt/repo/src/App.tsx")]),
            worktreeDir: "/wt/repo"
        )
        XCTAssertEqual(presentation.summary, "src/App.tsx")
        XCTAssertTrue(presentation.summaryIsPath)
    }

    func testPathsOutsideTheWorktreeShortenToTilde() {
        let presentation = ToolPresentation.make(
            toolName: "Read",
            input: .object(["file_path": .string("/home/ubuntu/notes/x.md")]),
            worktreeDir: "/wt/repo"
        )
        XCTAssertEqual(presentation.summary, "~/notes/x.md")
    }

    func testEditLineStatsComeFromTheInput() {
        let presentation = ToolPresentation.make(
            toolName: "Edit",
            input: .object([
                "file_path": .string("/wt/a.ts"),
                "old_string": .string("one\ntwo"),
                "new_string": .string("one\ntwo\nthree\nfour"),
            ]),
            worktreeDir: "/wt"
        )
        XCTAssertEqual(presentation.lineStats?.additions, 4)
        XCTAssertEqual(presentation.lineStats?.deletions, 2)
        XCTAssertEqual(presentation.touchedFiles.map(\.basename), ["a.ts"])
    }

    func testTodoSummaryNamesTheActiveStep() {
        let presentation = ToolPresentation.make(
            toolName: "TodoWrite",
            input: .object(["todos": .array([
                .object(["content": .string("one"), "status": .string("completed")]),
                .object(["content": .string("two"), "status": .string("in_progress")]),
                .object(["content": .string("three"), "status": .string("pending")]),
            ])])
        )
        XCTAssertEqual(presentation.summary, "two  ·  1/3 done")
    }

    func testEditsCarryTheirDiffForTheFileChipPreview() {
        let presentation = ToolPresentation.make(
            toolName: "Edit",
            input: .object([
                "file_path": .string("/wt/a.ts"),
                "old_string": .string("one"),
                "new_string": .string("two"),
            ]),
            worktreeDir: "/wt"
        )
        XCTAssertEqual(presentation.touchedFiles.first?.hunks, ["-one\n+two"])
    }

    func testToolsThatOnlyNamePathsCarryNoDiff() {
        // Bash touches files without reporting content; inventing a diff for
        // it would be worse than showing none.
        let presentation = ToolPresentation.make(
            toolName: "Bash",
            input: .object(["command": .string("rm a.ts")])
        )
        XCTAssertTrue(presentation.touchedFiles.isEmpty)
    }

    func testDurationsUnderASecondAreNotShown() {
        XCTAssertNil(TranscriptFormat.duration(0.4))
        XCTAssertEqual(TranscriptFormat.duration(12), "12s")
        XCTAssertEqual(TranscriptFormat.duration(184), "3m 4s")
        XCTAssertEqual(TranscriptFormat.duration(3_900), "1h 5m")
    }

    func testEditedFilesSummaryCountsTheRest() {
        let files = ["a.ts", "b.ts", "c.ts", "d.ts"].map {
            TouchedFile(path: "src/\($0)", additions: 1, deletions: 0)
        }
        XCTAssertEqual(TranscriptFormat.editedFiles(files), "a.ts, b.ts +2")
    }
}
