import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { errorMessage } from "../../lib/error-message";
import { fullTime } from "../../lib/time";
import { Button } from "../../ui/button";
import { DeviceCode } from "../../ui/device-code";
import {
  SettingCard,
  SettingRow,
  SettingRowControl,
  SettingRowDescription,
  SettingRowText,
  SettingRowTitle,
  SettingsGroupLabel,
  SettingsHint,
  StatusChip,
} from "../../ui/settings";
import { InlineAlert, LoadingState } from "../../ui/state";
import { IconTile } from "../BrandTile";
import {
  cancelXaiConnect,
  disconnectXai,
  fetchXaiStatus,
  pollXaiConnect,
  startXaiConnect,
  type XaiDeviceFlow,
  type XaiStatus,
} from "../../lib/api/xai";

/** How the card names a live connection: who turned it on, and when. */
function connectedNote(status: XaiStatus): string {
  return [
    status.connectedBy ? `Connected by @${status.connectedBy}` : "Connected",
    status.connectedAt
      ? fullTime(new Date(status.connectedAt).toISOString())
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The card itself, given a state rather than fetching one — so every state it
 * can be in (loading, connected, mid-sign-in, read-only for a non-admin) is
 * reachable from a test without a server.
 */
export function XaiConnectionCard({
  status,
  flow,
  busy,
  onConnect,
  onDisconnect,
  onStopWaiting,
}: {
  /** null while the first status request is in flight. */
  status: XaiStatus | null;
  /** A device sign-in in progress, if any. */
  flow: XaiDeviceFlow | null;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onStopWaiting: () => void;
}) {
  const canManage = status?.canManage ?? false;
  return (
    <>
      <SettingCard>
        {status === null ? (
          <LoadingState placement="row">Checking Grok…</LoadingState>
        ) : (
          <SettingRow>
            <IconTile name="xai" />
            <SettingRowText>
              <SettingRowTitle>Shared xAI subscription</SettingRowTitle>
              <SettingRowDescription>
                {status.connected
                  ? connectedNote(status)
                  : "One SuperGrok subscription for the whole workspace. Grok models stay out of the model picker until it is connected."}
              </SettingRowDescription>
            </SettingRowText>
            <SettingRowControl className="flex items-center gap-3">
              {status.connected && (
                <StatusChip label="Connected" dot="var(--green)" />
              )}
              {canManage &&
                (status.connected ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="phone:min-h-11"
                    disabled={busy}
                    onClick={onDisconnect}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="phone:min-h-11"
                    disabled={busy || !!flow}
                    onClick={onConnect}
                  >
                    {flow ? "Waiting for xAI…" : "Connect Grok"}
                  </Button>
                ))}
            </SettingRowControl>
          </SettingRow>
        )}

        {flow && (
          // A well below the row, so the live sign-in reads as a step rather
          // than as another setting.
          <div
            role="status"
            aria-live="polite"
            className="px-5 py-4 text-supporting"
          >
            <div>
              1. Open{" "}
              <a
                href={flow.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="text-link underline"
              >
                {flow.verificationUri}
              </a>{" "}
              and sign in to the xAI account.
            </div>
            <div className="mt-1.5">2. Enter this one-time code:</div>
            <div className="my-2">
              <DeviceCode code={flow.userCode} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-dim">
              Waiting for the sign-in to complete… this panel updates by itself.
              <Button
                size="sm"
                variant="ghost"
                className="phone:min-h-11"
                onClick={onStopWaiting}
              >
                Stop waiting
              </Button>
            </div>
          </div>
        )}
      </SettingCard>

      <SettingsHint>
        {canManage
          ? "Signing in with SuperGrok or X Premium bills turns to that subscription rather than to metered API credits. An xAI API key below is the metered alternative, not the same connection."
          : "Only a workspace administrator can connect or disconnect this, because every session shares the one credential."}
      </SettingsHint>
    </>
  );
}

/**
 * The one shared Grok subscription, in Settings → Providers.
 *
 * It sits between the subscription pools above and the api-keyed providers
 * below because it is neither. There is a single workspace-wide credential
 * with no per-person assignment and no usage meter to read, so this is one
 * row rather than a list — and connecting it changes what everyone can run,
 * which is why only an administrator gets the buttons.
 *
 * The sign-in is a device flow, so the code and the link belong in the card:
 * the person completes it on another device while this panel waits. Nothing
 * here ever holds a token — the server keeps it and never returns it.
 */
export function XaiConnectionSection({
  onChanged,
}: {
  /** Connecting or disconnecting changes the models a run can pick, so the
   *  surfaces that keep a model list alongside this one refresh through here. */
  onChanged?: () => void;
} = {}) {
  const [status, setStatus] = useState<XaiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<XaiDeviceFlow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchXaiStatus());
    } catch (cause) {
      setError(errorMessage(cause, "Could not load the Grok connection"));
      // Leave the card readable rather than spinning forever, and assume the
      // stricter answer about who may change it.
      setStatus((current) => current ?? { connected: false, canManage: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pollTick = useEffectEvent(async () => {
    if (!flow) return;
    // The code dies on xAI's clock, and a dead one only ever comes back
    // rejected — stop rather than ask again.
    if (Date.now() > flow.expiresAt) {
      setFlow(null);
      setError("The sign-in code expired before it was used. Start again.");
      return;
    }
    try {
      const result = await pollXaiConnect(flow.flowId);
      if (result.status === "pending") return;
      setFlow(null);
      if (result.status === "error") setError(result.error);
      else {
        await load();
        onChanged?.();
      }
    } catch {
      // Keep polling. A transient failure does not end the device flow.
    }
  });

  const flowId = flow?.flowId;
  // This asks OUR server how its flow is going; xAI's own polling interval is
  // pi's business, so there is no slow_down to earn here.
  useEffect(() => {
    if (!flowId) return;
    const timer = setInterval(() => void pollTick(), 2000);
    return () => clearInterval(timer);
  }, [flowId]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      setFlow(await startXaiConnect());
    } catch (cause) {
      setError(errorMessage(cause, "Could not start the Grok sign-in"));
    }
    setBusy(false);
  }

  /** Stop waiting locally AND server-side: an abandoned flow otherwise keeps
   *  a login open against xAI until its code expires. */
  function stopWaiting() {
    const pending = flow;
    setFlow(null);
    if (pending) void cancelXaiConnect(pending.flowId).catch(() => undefined);
  }

  async function disconnect() {
    if (
      !confirm(
        "Disconnect Grok? Every session in the workspace loses its Grok models until someone connects it again.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await disconnectXai();
      await load();
      onChanged?.();
    } catch (cause) {
      setError(errorMessage(cause, "Could not disconnect Grok"));
    }
    setBusy(false);
  }

  return (
    <>
      <SettingsGroupLabel>Grok</SettingsGroupLabel>
      {error && (
        <InlineAlert className="mb-2" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      <XaiConnectionCard
        status={status}
        flow={flow}
        busy={busy}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
        onStopWaiting={stopWaiting}
      />
    </>
  );
}
