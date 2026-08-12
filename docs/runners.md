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
audited command delegation. A session may explicitly select an eligible Runner
under Other machines. Its repository workspace is created below an
administrator-approved root, and its run host uses the same durable outbound
stream as a remote Sandbox. Automation sessions never receive Runner tools.
Runners run work as their local service user, so only attach machines the
workspace intends to trust.
