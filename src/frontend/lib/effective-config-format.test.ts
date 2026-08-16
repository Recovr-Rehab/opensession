import { describe, expect, test } from "bun:test";
import {
	formatConfigValue,
	groupMcpExclusions,
	mcpCounts,
	mcpScopeSummary,
} from "./effective-config-format";
import type { EffectiveMcpServer } from "./api/effective-config";

describe("formatConfigValue", () => {
	test("reads a boolean as an answer, not as a literal", () => {
		expect(formatConfigValue(true)).toBe("Yes");
		expect(formatConfigValue(false)).toBe("No");
	});

	test("an absent value is the table dash, never 'null'", () => {
		expect(formatConfigValue(null)).toBe("–");
		expect(formatConfigValue(undefined)).toBe("–");
		expect(formatConfigValue("")).toBe("–");
	});

	test("an empty list says None rather than rendering nothing", () => {
		expect(formatConfigValue([])).toBe("None");
		expect(formatConfigValue(["claude-opus-5", "claude-fable-5"])).toBe(
			"claude-opus-5, claude-fable-5",
		);
	});

	test("a labelled record leads with its label", () => {
		// account.sticky
		expect(formatConfigValue({ id: "6593ff37", name: "Michiel-com" })).toBe(
			"Michiel-com",
		);
		// model.preset
		expect(
			formatConfigValue({
				id: "dial/opus-fable",
				label: "Opus 5 + Fable oracle",
				mainModel: "claude-opus-5",
			}),
		).toBe("Opus 5 + Fable oracle");
	});

	test("an account keeps the reason it was picked", () => {
		expect(
			formatConfigValue({ id: "6593ff37", name: "Michiel-com", reason: "sticky" }),
		).toBe("Michiel-com · sticky");
	});

	test("a commit author with no email does not trail a separator", () => {
		expect(formatConfigValue({ name: "Automation", email: "" })).toBe(
			"Automation",
		);
	});

	test("an unlabelled record falls back to its own keys", () => {
		expect(
			formatConfigValue({ agent: "oracle-fable", model: "anthropic/claude-fable-5" }),
		).toBe("agent: oracle-fable · model: anthropic/claude-fable-5");
	});
});

describe("mcpScopeSummary", () => {
	test("no allowlist and an EMPTY allowlist are different answers", () => {
		expect(mcpScopeSummary("all")).toContain("No allowlist");
		// An automation recipe with no mcpServers: the case the panel exists for.
		expect(mcpScopeSummary([])).toContain("Empty allowlist");
	});

	test("a named allowlist names its servers", () => {
		expect(mcpScopeSummary(["grafana", "incident"])).toBe(
			"Allowlist of 2: grafana, incident",
		);
	});
});

describe("mcpCounts", () => {
	const server = (
		name: string,
		included: boolean,
	): EffectiveMcpServer => ({
		name,
		included,
		reason: "",
		source: "",
		transport: "local",
	});

	test("counts both sides of the gate", () => {
		expect(mcpCounts([server("a", true), server("b", false), server("c", true)])).toEqual({
			included: 2,
			excluded: 1,
			total: 3,
		});
	});

	test("an automation with an empty allowlist sees nothing", () => {
		expect(mcpCounts([server("a", false), server("b", false)])).toEqual({
			included: 0,
			excluded: 2,
			total: 2,
		});
	});
});

describe("groupMcpExclusions", () => {
	const hidden = (
		name: string,
		reason: string,
		source: string,
	): EffectiveMcpServer => ({
		name,
		included: false,
		reason,
		source,
		transport: "remote",
	});

	test("one gate is stated once, however many servers it hid", () => {
		const groups = groupMcpExclusions([
			hidden("a", "outside this run's MCP allowlist", "mcp-config.json"),
			hidden("b", "outside this run's MCP allowlist", "mcp-config.json"),
			{ ...hidden("c", "", ""), included: true, reason: "in", source: "x" },
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.names).toEqual(["a", "b"]);
		expect(groups[0]!.sources).toEqual(["mcp-config.json"]);
	});

	test("the same gate reported from two paths stays one group", () => {
		// A server carrying allowedUsers names that check in its source even
		// when the allowlist is what hid it — that must not print the sentence
		// twice.
		const groups = groupMcpExclusions([
			hidden("brex", "outside this run's MCP allowlist", "mcp-config.json → allowedUsers"),
			hidden("plain", "outside this run's MCP allowlist", "mcp-config.json"),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.sources).toHaveLength(2);
	});

	test("the particular gate sorts above the bulk one", () => {
		const groups = groupMcpExclusions([
			hidden("a", "outside this run's MCP allowlist", "cfg"),
			hidden("b", "outside this run's MCP allowlist", "cfg"),
			hidden("brex", "allowedUsers gate: none of [Automation] matches [Michiel]", "cfg"),
		]);
		expect(groups[0]!.names).toEqual(["brex"]);
	});

	test("included servers never appear", () => {
		expect(
			groupMcpExclusions([{ ...hidden("a", "r", "s"), included: true }]),
		).toEqual([]);
	});
});
