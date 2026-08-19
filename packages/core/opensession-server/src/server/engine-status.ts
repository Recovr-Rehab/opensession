/** Shared readiness check for Setup and `opensession doctor`. */
import { listAccountsPublic } from "./claude-accounts";
import { listCodexAccountsPublic } from "./codex-accounts";
import { accountProviderForModel, interactiveDefaultModel } from "./models";
import { modelProviders } from "./model-providers";
import { piConfigPath, piEngineEnabled } from "./pi-config";
import { homeDir } from "./paths";

function engineConfigLabel(): string {
  const home = homeDir();
  const path = piConfigPath();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export interface EngineStatus {
  piEnabled: boolean;
  claudeAccounts: number;
  codexAccounts: number;
  defaultModel: string;
  provider: "claude" | "codex" | undefined;
  ready: boolean;
  blocker: string | null;
  fix: string | null;
  fixableInApp: boolean;
}

export function engineStatus(): EngineStatus {
  const enabled = piEngineEnabled();
  const claudeAccounts = listAccountsPublic().length;
  const codexAccounts = listCodexAccountsPublic().length;
  const defaultModel = interactiveDefaultModel();
  const provider = accountProviderForModel(defaultModel);
  const base = {
    piEnabled: enabled,
    claudeAccounts,
    codexAccounts,
    defaultModel,
    provider,
  };
  const blocked = (blocker: string, fix: string, fixableInApp = false) => ({
    ...base,
    ready: false,
    blocker,
    fix,
    fixableInApp,
  });

  if (!enabled) {
    return blocked(
      "The Pi engine is switched off, so no agent turn can run.",
      `Turn it on here. This writes \`enabled: true\` to ${engineConfigLabel()}.`,
      true,
    );
  }
  if (provider === "claude" && !claudeAccounts) {
    return blocked(
      "No Claude accounts are available for the default model.",
      "Add a Claude account under Workspace → Models.",
    );
  }
  if (provider === "codex" && !codexAccounts) {
    return blocked(
      "No ChatGPT accounts are available for the default model.",
      "Add a ChatGPT account under Workspace → Models.",
    );
  }
  if (
    !provider &&
    !claudeAccounts &&
    !codexAccounts &&
    !Object.keys(modelProviders()).length
  ) {
    return blocked(
      `No model capacity is configured for "${defaultModel}".`,
      "Add a Claude or ChatGPT account, or a provider API key, under Workspace → Models.",
    );
  }
  return { ...base, ready: true, blocker: null, fix: null, fixableInApp: false };
}
