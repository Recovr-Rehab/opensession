import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  WAFER_PICKER_MODELS,
  defaultPickerModelsForProvider,
  opencodeProviderOptions,
  waferModelEfforts,
} from "./opencode-config";
import { modelEfforts, opencodeModelLabel } from "./models";

const originalConfig = process.env.OPENSESSION_OPENCODE_CONFIG;
const tempDir = join(
  process.env.TMPDIR || "/tmp",
  `opensession-wafer-test-${process.pid}`,
);

afterEach(() => {
  if (originalConfig === undefined)
    delete process.env.OPENSESSION_OPENCODE_CONFIG;
  else process.env.OPENSESSION_OPENCODE_CONFIG = originalConfig;
  rmSync(tempDir, { recursive: true, force: true });
});

function waferProvider() {
  mkdirSync(tempDir, { recursive: true });
  const config = join(tempDir, "opencode.json");
  writeFileSync(
    config,
    JSON.stringify({
      enabled: true,
      providers: { wafer: { apiKey: "wfr-test" } },
    }),
  );
  process.env.OPENSESSION_OPENCODE_CONFIG = config;
  return opencodeProviderOptions().wafer;
}

describe("Wafer provider", () => {
  test("seeds the public catalog", () => {
    expect(defaultPickerModelsForProvider("wafer")).toEqual(
      WAFER_PICKER_MODELS,
    );
    expect(WAFER_PICKER_MODELS).toContain("DeepSeek-V4-Flash-0731-Fast");
    expect(WAFER_PICKER_MODELS).toHaveLength(7);
    expect(defaultPickerModelsForProvider("xai")).toEqual([]);
  });

  test("injects an OpenAI-compatible provider on Wafer's endpoint", () => {
    const provider = waferProvider();
    expect(provider).toMatchObject({
      npm: "@ai-sdk/openai-compatible",
      name: "Wafer",
      options: { apiKey: "wfr-test", baseURL: "https://pass.wafer.ai/v1" },
    });
    expect(Object.keys(provider.models as object)).toEqual([
      ...WAFER_PICKER_MODELS,
    ]);
    expect(
      (provider.models as Record<string, unknown>)[
        "DeepSeek-V4-Flash-0731-Fast"
      ],
    ).toMatchObject({
      name: "DeepSeek V4 Flash",
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
      limit: { context: 1_048_576 },
      cost: { input: 0.28, output: 0.56 },
    });
  });

  test("carries a reasoning variant for every model, since Wafer defaults thinking off", () => {
    const models = waferProvider().models as Record<
      string,
      { variants: Record<string, { reasoningEffort: string }> }
    >;
    for (const [id, model] of Object.entries(models)) {
      const variants = Object.keys(model.variants);
      expect(variants.length).toBeGreaterThan(0);
      expect(variants).toEqual([...waferModelEfforts(id)]);
      expect(model.variants.high).toEqual({ reasoningEffort: "high" });
    }
  });

  test("exposes catalog labels and per-model efforts", () => {
    expect(
      opencodeModelLabel("opencode/wafer/DeepSeek-V4-Flash-0731-Fast"),
    ).toBe("DeepSeek V4 Flash");
    expect(opencodeModelLabel("opencode/wafer/glm5.2-fast")).toBe(
      "GLM 5.2 Fast",
    );
    expect(opencodeModelLabel("opencode/wafer/Kimi-K2.6")).toBe("Kimi K2.6");
    // One ladder across the catalog — Wafer normalizes effort at its edge, so
    // the DeepSeek and Kimi routes take `medium` too despite their upstream
    // catalogs listing only low/high/max.
    for (const id of ["DeepSeek-V4-Flash-0731-Fast", "Kimi-K3", "GLM-5.2"]) {
      expect(modelEfforts(`opencode/wafer/${id}`)).toEqual([
        "low",
        "medium",
        "high",
        "max",
      ]);
    }
    expect(modelEfforts("opencode/wafer/not-a-wafer-model")).toEqual([]);
  });
});
