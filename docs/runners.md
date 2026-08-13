# Runners

A Runner is a persistent computer your workspace explicitly trusts for work
that needs a particular platform, toolchain, or GPU. It is not an isolated
Sandbox.

Workspace administrators pair a Runner from **Settings → Runners**. The
pairing code is one-time and expires after ten minutes. On the target machine:

```sh
opensession runner connect --server https://your-opensession-host --code CODE
```

Connect installs a per-user LaunchAgent or systemd user service when one is
available. It reconnects after restart. If installation is unavailable, run
`opensession runner service install` after configuring a user service manager.
The Runner connects outbound over the tailnet. Open Session never dials into
the machine.

Administrators choose its permissions, eligible people and repositories,
managed workspace roots, maintenance state, and revocation. Revoking a Runner
invalidates its credential and closes its control connection immediately.

Interactive sessions can use the `opensession-runners` MCP tools for scoped,
audited command delegation. Automation sessions never receive Runner tools.
Runners run work as their local service user, so only attach machines the
workspace intends to trust.

## Operator-managed migration

Workspace administrators can also migrate a named SSH machine or a named
Kubernetes Runner workload from Settings. These choices appear only when the
operator has configured `integrations.runnersBootstrap` in the protected
instance configuration. SSH entries require both a pinned `SHA256:` host
fingerprint and a dedicated known-hosts file. Kubernetes entries name one
context, namespace, deployment, and optional container, plus a reviewed
manifest path for that dedicated deployment and its persistent workspace
volume. Bootstrap applies the manifest with a fixed field manager, waits for
rollout, and returns bounded pod scheduling diagnostics if it cannot become
ready.

The migration performs only the reviewed `opensession runner connect` action,
then the component installs its reconnecting service and dials out normally.
Agents never receive SSH, kubectl, private-key, kubeconfig, or pairing-token
access. Kubernetes credentials must be RBAC-scoped to the configured Runner
namespace and workload.
