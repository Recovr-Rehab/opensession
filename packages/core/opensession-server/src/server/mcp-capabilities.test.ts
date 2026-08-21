import { describe, expect, test } from "bun:test";
import {
  INTERNAL_MCP_CAPABILITIES,
  renderInternalMcpCapabilities,
} from "./mcp-capabilities";
import { MCP_SERVER_CATALOG } from "./mcp-catalog";
import { buildRunInstructions } from "./run-instructions";

describe("internal MCP capability guidance", () => {
  test("the lightweight metadata covers the complete server catalog", () => {
    expect(Object.keys(INTERNAL_MCP_CAPABILITIES).sort()).toEqual(
      MCP_SERVER_CATALOG.map((entry) => entry.name).sort(),
    );
  });

  test("renders only capabilities available in this run", () => {
    const note = renderInternalMcpCapabilities(
      {
        "opensession-runners": {},
        "opensession-memory": {},
        external: {},
      },
      "Open Session",
    );

    expect(note).toContain("## Open Session internal tools");
    expect(note).toContain("`mcp_search`");
    expect(note).toContain("`mcp_call`");
    expect(note).toContain("`opensession-runners`");
    expect(note).toContain("trusted and persistent, not a Sandbox");
    expect(note).toContain("`opensession-memory`");
    expect(note).not.toContain("`opensession-workflows`");
    expect(note).not.toContain("`external`");
  });

  test("renders the full set once in deterministic order within a bounded budget", () => {
    const names = Object.keys(INTERNAL_MCP_CAPABILITIES);
    const reversed = Object.fromEntries([...names].reverse().map((name) => [name, {}]));
    const note = renderInternalMcpCapabilities(reversed);
    const capabilityLines = note.split("\n").filter((line) => line.startsWith("- `opensession-"));

    expect(capabilityLines).toHaveLength(names.length);
    expect(capabilityLines.map((line) => line.match(/`([^`]+)`/)?.[1])).toEqual(names);
    expect(new Set(capabilityLines).size).toBe(capabilityLines.length);
    expect(note.length).toBeLessThan(4_500);
  });

  test("legacy aliases render once under their canonical names", () => {
    const note = renderInternalMcpCapabilities({
      "michael-sessions": {},
      "opensession-sessions": {},
      "michael-ask": {},
    });

    expect(note.match(/`opensession-sessions`/g)).toHaveLength(1);
    expect(note.match(/`opensession-ask`/g)).toHaveLength(1);
    expect(note).not.toContain("michael-");
  });

  test("omits the section when no internal server is available", () => {
    expect(renderInternalMcpCapabilities(undefined)).toBe("");
    expect(renderInternalMcpCapabilities({ external: {} })).toBe("");
  });

  test("the runtime system prompt includes the filtered index", () => {
    const prompt = buildRunInstructions({
      isAsk: false,
      inProcessMcp: {
        "opensession-workflows": {},
        "opensession-papercuts": {},
      },
    });

    expect(prompt).toContain("## Open Session internal tools");
    expect(prompt).toContain("`opensession-workflows`");
    expect(prompt).toContain("`opensession-papercuts`");
    expect(prompt).not.toContain("`opensession-runners`");
    expect(prompt).toContain("## Dynamic workflows");
    expect(prompt).toContain("## Log papercuts");
  });
});
