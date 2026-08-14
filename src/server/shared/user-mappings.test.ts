import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TeamMember } from "../config";
import {
  __setIdentitiesForTest,
  commitAuthorFor,
  deriveIdentityTables,
  githubLoginToPersonKeyFromTeam,
  personKeyToDisplayName,
} from "./user-mappings";

const TEAM: TeamMember[] = [
  {
    name: "Alice Example",
    email: "alice@example.com",
    aliases: ["alice", "ali"],
    slackId: "U_ALICE",
    github: "alice",
    linearEmails: ["alice@work.example"],
  },
  {
    name: "Bob Builder",
    email: "bob@example.com",
    slackId: "U_BOB",
    github: "bob",
    linearEmails: ["bob@work.example"],
    githubToSlack: false,
  },
];

describe("identity table derivation", () => {
  test("derives GitHub, Slack, Linear, and git attribution tables from config", () => {
    const tables = deriveIdentityTables(TEAM, { U_SYSTEM: "Build Bot" });

    expect(tables.githubToSlack).toEqual({ alice: "U_ALICE" });
    expect(tables.linearEmailToGithub).toEqual({
      "alice@work.example": "alice",
      "bob@work.example": "bob",
    });
    expect(tables.slackIdToName).toEqual({
      U_ALICE: "Alice Example",
      U_BOB: "Bob Builder",
      U_SYSTEM: "Build Bot",
    });
    expect(tables.teamGitIdentity).toEqual([
      {
        name: "Alice Example",
        email: "alice@example.com",
        aliases: ["alice", "ali"],
        slackId: "U_ALICE",
        github: "alice",
      },
      {
        name: "Bob Builder",
        email: "bob@example.com",
        aliases: ["bob"],
        slackId: "U_BOB",
        github: "bob",
      },
    ]);
  });

  test("empty team produces empty tables", () => {
    expect(deriveIdentityTables([], {})).toEqual({
      githubToSlack: {},
      linearEmailToGithub: {},
      slackIdToName: {},
      teamGitIdentity: [],
    });
  });

  test("member without explicit aliases uses the lowercased first name", () => {
    const tables = deriveIdentityTables([
      { name: "Ada Lovelace", email: "ada@example.com" },
    ]);
    expect(tables.teamGitIdentity).toEqual([
      { name: "Ada Lovelace", email: "ada@example.com", aliases: ["ada"] },
    ]);
  });

  test("directory display helpers accept an explicit configured team", () => {
    expect(githubLoginToPersonKeyFromTeam("alice", TEAM)).toBe("alice");
    expect(githubLoginToPersonKeyFromTeam("unknown", TEAM)).toBeNull();
    expect(personKeyToDisplayName("ali", TEAM)).toBe("Alice");
    expect(personKeyToDisplayName("unknown", TEAM)).toBeNull();
  });
});

describe("commit attribution", () => {
  // Roster-dependent: pin a fixture team so the assertions don't read the
  // operator's own ~/.opensession/config.json.
  let restore: (() => void) | undefined;
  beforeAll(() => {
    restore = __setIdentitiesForTest(TEAM);
  });
  afterAll(() => restore?.());

  test("the prompt's sender wins", () => {
    expect(commitAuthorFor("alice", "Bob Builder")).toEqual({
      name: "Alice Example",
      email: "alice@example.com",
    });
  });

  test("a turn nobody sent is the session owner's work", () => {
    // The senders the server's own resume paths pass. None is a person, and
    // without the fallback each one dropped the commit onto the bot identity.
    for (const sender of [undefined, null, "", "auto-continue", "anonymous"]) {
      expect(commitAuthorFor(sender, "Bob Builder")).toEqual({
        name: "Bob Builder",
        email: "bob@example.com",
      });
    }
  });

  test("an owner who is on no roster keeps the machine's identity", () => {
    // What an automation-owned session looks like: its owner is the
    // automation's name, so there is no person to credit and the commit
    // stays the bot's.
    expect(commitAuthorFor("auto-continue", "Dreaming (automation)")).toBeNull();
    expect(commitAuthorFor(null, null)).toBeNull();
  });
});
