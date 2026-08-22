import React, { useEffect, useState } from "react";
import { useSetupStatus } from "../hooks/useSetupStatus";
import { DEFAULT_DOC_TITLE, docTitle } from "../lib/brand";
import { Button } from "../ui/button";
import {
  SettingCard,
  SettingsGroupLabel,
  SettingsHeader,
  SettingsHint,
  SettingsPanel,
} from "../ui/settings";
import { LoadingState } from "../ui/state";
import { EngineRow, SetupChecklist } from "./SetupChecklist";
import { IdentityCard } from "./SetupIdentity";
import { IntegrationsList } from "./SetupIntegrations";
import { ReposSection } from "./SetupRepos";
import { SetupRestart } from "./SetupRestart";
import {
  ClaudeAccountsSection,
  CodexAccountsSection,
} from "./settings/ModelAccounts";
import { ModelProvidersPanel } from "./ModelProviders";
import { ModelDefaultsSection } from "./Models";
import { IconArrowUpRight, IconGlobe } from "./icons";

function SetupPageSection({
  title,
  description,
  children,
  className = "mt-10",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-3 px-5">
        <h2 className="m-0 text-section-title font-title tracking-[-0.015em] text-fg">
          {title}
        </h2>
        <p className="m-0 mt-1.5 max-w-[62ch] text-supporting leading-relaxed text-dim">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

export function SetupPanel({
  onOpenOnboarding,
}: {
  onOpenOnboarding: () => void;
}) {
  const setup = useSetupStatus();
  const { status, failed, refetch } = setup;
  const [aiRevision, setAiRevision] = useState(0);

  useEffect(() => {
    document.title = docTitle("Setup");
    return () => {
      document.title = DEFAULT_DOC_TITLE;
    };
  }, []);

  async function refreshAi() {
    setAiRevision((revision) => revision + 1);
    await refetch();
  }

  return (
    <SettingsPanel className="relative [&_input]:phone:text-input-phone">
      <SettingsHeader
        title="Workspace setup"
        actions={
          <Button size="sm" onClick={onOpenOnboarding}>
            Open onboarding
          </Button>
        }
      />
      {!status ? (
        <LoadingState>
          {failed ? "Couldn't load setup status." : "Loading…"}
        </LoadingState>
      ) : (
        <>
          <SetupPageSection
            title="Server access"
            description="Keep the instance private and make it reachable from your devices."
            className="mt-0"
          >
            <SettingCard>
              <div className="flex items-start gap-3 px-5 py-4">
                <IconGlobe
                  size={22}
                  className="mt-0.5 shrink-0 text-dim"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-row-title font-medium text-fg">
                    Private server setup
                  </div>
                  <p className="m-0 mt-1 text-supporting leading-relaxed text-dim">
                    Create a VPS, connect it through Tailscale, and install Open
                    Session.
                  </p>
                  <a
                    href="https://opensession.com/setup"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-label font-medium text-blue hover:underline desktop:min-h-0"
                  >
                    Set up a server <IconArrowUpRight size={16} />
                  </a>
                </div>
              </div>
            </SettingCard>
            <SettingsHint>
              This instance currently opens at {status.publicBaseUrl}. Keep
              ports 3848 and 3850 closed to the public internet.
            </SettingsHint>
          </SetupPageSection>

          <SetupPageSection
            title="Connect GitHub"
            description="Give sessions access to repositories and pull requests."
          >
            <IntegrationsList
              integrations={status.integrations.filter(
                (integration) => integration.id === "github",
              )}
              onSaved={setup.applyIntegration}
            />
          </SetupPageSection>

          <SetupPageSection
            title="Name your instance"
            description="Choose the names this instance and its agent use when they introduce themselves."
          >
            <IdentityCard />
          </SetupPageSection>

          <SetupPageSection
            title="Choose your AI"
            description="Connect Claude, OpenAI Codex, or another provider with an API key."
          >
            <ModelDefaultsSection key={aiRevision} />
            <SettingsGroupLabel>Engine</SettingsGroupLabel>
            <SettingCard>
              <EngineRow engine={status.engine} onChanged={refetch} />
            </SettingCard>
            <ClaudeAccountsSection compact onChanged={refreshAi} />
            <CodexAccountsSection compact onChanged={refreshAi} />
            <ModelProvidersPanel />
          </SetupPageSection>

          <SetupPageSection
            title="Add repositories"
            description="Register the repositories sessions can work in."
          >
            <ReposSection repos={status.repos} onChanged={refetch} />
          </SetupPageSection>

          <SetupPageSection
            title="Setup status"
            description="Review what is ready before you start a session."
          >
            <SetupChecklist status={status} onChanged={refetch} />
          </SetupPageSection>
        </>
      )}
      <SetupRestart setup={setup} />
    </SettingsPanel>
  );
}
