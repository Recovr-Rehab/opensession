import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { SettingsSection } from "../ui/settings";
import { InlineAlert, LoadingState } from "../ui/state";
import {
  fetchFeaturebaseStatus,
  type FeaturebaseAdmin,
} from "../lib/api/featurebase";

/** Live Featurebase connection check inside Settings → Integrations. */
export function FeaturebaseConfiguration({
  apiKeyPresent,
}: {
  apiKeyPresent: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [tickets, setTickets] = useState<number | null>(null);
  const [posts, setPosts] = useState<number | null>(null);
  const [admins, setAdmins] = useState<FeaturebaseAdmin[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    const body = await fetchFeaturebaseStatus();
    setOk(body.ok);
    setTickets(body.tickets ?? null);
    setPosts(body.posts ?? null);
    setAdmins(body.admins ?? []);
    setError(body.ok ? null : body.error || "Could not reach Featurebase");
    setLoading(false);
  }

  useEffect(() => {
    if (apiKeyPresent) void check();
  }, [apiKeyPresent]);

  if (!apiKeyPresent) {
    return (
      <SettingsSection className="border-0 bg-panel p-4">
        <p className="m-0 text-supporting text-dim">
          Paste the API key above, save, and restart Open Session. Reopen this
          dialog to verify the connection and copy your admin id.
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection className="flex flex-col gap-3 border-0 bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-item-title font-medium text-fg">Connection</div>
          <p className="m-0 mt-0.5 text-supporting text-dim">
            Uses the saved API key. A restart is required after the first save.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void check()}
        >
          {loading ? "Checking…" : "Check connection"}
        </Button>
      </div>
      {loading && !ok && !error ? (
        <LoadingState>Checking Featurebase</LoadingState>
      ) : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {ok ? (
        <p className="m-0 text-supporting text-fg">
          Connected. {tickets ?? 0} open tickets and {posts ?? 0} recent posts
          visible.
        </p>
      ) : null}
      {admins.length > 0 ? (
        <div>
          <div className="text-control-label font-medium text-fg">Admins</div>
          <p className="m-0 mt-0.5 mb-2 text-supporting text-dim">
            Copy your id into FEATUREBASE_ADMIN_ID so replies and notes have an
            author.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {admins.map((admin) => (
              <li
                key={admin.id || admin.email || admin.name}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate text-sm text-fg">
                  {admin.name || "Unnamed"}
                  {admin.email ? ` · ${admin.email}` : ""}
                </span>
                {admin.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(admin.id!);
                      setCopied(admin.id);
                    }}
                  >
                    {copied === admin.id ? "Copied" : "Copy id"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SettingsSection>
  );
}
