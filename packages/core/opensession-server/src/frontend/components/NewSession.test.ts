import { expect, test } from "bun:test";

test("the new composer uses the shared model settings component with every axis", async () => {
  const source = await Bun.file(new URL("./NewSession.tsx", import.meta.url)).text();
  const pickerStart = source.indexOf("<ModelEffortSelect");
  const pickerEnd = source.indexOf("/>", pickerStart);
  const picker = source.slice(pickerStart, pickerEnd);

  expect(pickerStart).toBeGreaterThan(-1);
  expect(picker).toContain("effort={effort}");
  expect(picker).toContain("onEffortChange={setEffort}");
  expect(picker).toContain("fastMode={fastMode}");
  expect(picker).toContain("onFastModeChange={setFastMode}");
  expect(picker).toContain("accounts={accounts}");
  expect(picker).toContain("accountId={accountId}");
  expect(picker).toContain("onAccountChange={setAccountId}");
});

test("the new session payload persists fast mode", async () => {
  const source = await Bun.file(new URL("./NewSession.tsx", import.meta.url)).text();
  const createStart = source.indexOf('type: "create_session"');
  const createEnd = source.indexOf("const canCreate =", createStart);
  const createPayload = source.slice(createStart, createEnd);

  expect(createStart).toBeGreaterThan(-1);
  expect(createEnd).toBeGreaterThan(createStart);
  expect(createPayload).toContain("...(fastMode ? { fastMode: true } : {})");
});
