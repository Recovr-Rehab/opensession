import { expect, test } from "bun:test";

test("the new composer keeps the full model name ahead of its effort suffix", async () => {
  const source = await Bun.file(new URL("./NewSession.tsx", import.meta.url)).text();
  const pillStart = source.indexOf("const MODEL_PILL");
  const pillEnd = source.indexOf(");", pillStart);
  const pill = source.slice(pillStart, pillEnd);

  expect(pillStart).toBeGreaterThan(-1);
  expect(pill).toContain("max-w-none");
  expect(pill).toContain("phone:[&_[data-effort]]:hidden");
  expect(pill).not.toContain("max-w-[150px]");
});

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

test("dismissing a nonempty composer parks it without an explicit draft action", async () => {
  const source = await Bun.file(new URL("./NewSession.tsx", import.meta.url)).text();
  const closeStart = source.indexOf("onOpenChange={(next) =>");
  const closeEnd = source.indexOf("modal=\"trap-focus\"", closeStart);
  const closeHandler = source.slice(closeStart, closeEnd);

  expect(closeStart).toBeGreaterThan(-1);
  expect(closeHandler).toContain("if (next || busy) return;");
  expect(closeHandler).toContain("void parkDraftOnExit();");
  expect(closeHandler.indexOf("void parkDraftOnExit();")).toBeLessThan(
    closeHandler.indexOf("onBack();"),
  );
  const createStart = source.indexOf("function handleCreate()");
  const sendStart = source.indexOf("send({", createStart);
  const createHandler = source.slice(createStart, sendStart);
  expect(createHandler).toContain("consumePendingDraftParks(prompt, workspaceId);");
  expect(source).not.toContain('action: "draft"');
  expect(source).not.toContain("Save as draft");
});
