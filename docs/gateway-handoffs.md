# Gateway handoffs

Open Session can promote gateway-only releases without an active-active window.
The SessionKernel and executor stay on their current release during this narrow
path; changes to either peer, dependencies, protocol surfaces, deployment
machinery, or service units use the coordinated rollout instead.

## Ownership invariants

1. Exactly one gateway may cross the activation boundary. systemd owns the
   stable public TCP socket and passes it to the byte-forwarding supervisor;
   gateway children bind private loopback backend ports.
2. Every gateway acquires the OS-backed `gateway-active.lock` before touching
   shared state, binding a listener, starting a Worker or timer, or contacting
   an integration.
3. A standby may statically import code, but waits on authenticated parent IPC
   before acquiring the lease or producing effects.
4. The supervisor sends activation only after the old child has exited.
5. After the old child exits, the supervisor atomically moves the immutable
   runtime pointer before activation. Gateway, executor, and SessionKernel must
   then report the exact same immutable generation before effects are admitted.
6. Coordinated rollback parks the target gateway first, restores the pointer
   and both peers, and only then admits the previous gateway. Mixed generations
   never run during recovery.

The lease is an independent fence, not an optimization. If the supervisor is
stale or crashes, a replacement child fails closed while the surviving gateway
still holds the lock.

## Handoff sequence

`deploy/self-deploy.sh` prepares and validates the candidate frontend first. A
generated import-closure manifest then chooses one of three flows:

- Frontend only: restart-free frontend pointer promotion.
- Gateway only: preload candidate, drain old child, observe exit, atomically
  move `current`, activate, then require `/ready`.
- Protocol, executor, or SessionKernel changes: park the preloaded candidate,
  replace both peers while the supervisor keeps the public listener bound, then
  activate only after peer readiness.
- Supervisor, service-unit, or privileged deploy machinery changes: use the
  root rollout. The systemd-owned socket remains bound while the supervisor is
  replaced.

During a gateway handoff, the old process continues serving while it performs
its bounded shutdown drain. The supervisor keeps the public TCP listener bound
throughout cut-over; connections accepted between child exit and candidate bind
stay paused and attach to the candidate backend once it is live. Web and native
clients receive `server_restarting`; they retry every 250ms until the candidate
handshake.

## Failure behavior

- Import or preload failure: kill the inert candidate; old gateway remains
  authoritative and `current` does not move.
- Old gateway misses its exit deadline: kill the inert candidate and keep the
  pointer unchanged. Operators investigate the old process rather than risk a
  second writer.
- Candidate fails after activation: park it with no active backend, restore
  `current`, executor, and SessionKernel, then start the previous immutable
  gateway and require matching-generation readiness.
- Candidate and rollback both fail: the supervisor exits so systemd performs a
  clean service-level recovery. The OS lease still prevents overlap.
- Frontend preparation failure: no lifecycle marker, pointer, schema floor, or
  service state changes.

The regular watchdog and last-known-good pin remain armed after a successful
handoff and can perform a coordinated rollback if later health probes fail.

## Coordinated peer handoff

For dependency and protocol releases, `prepare-coordinated` preloads the target,
drains the old gateway, atomically promotes `current`, and leaves the candidate
behind its activation barrier. The deploy controller restarts the executor and
SessionKernel while the public TCP proxy accepts and pauses new connections.
Only after both peers report the target generation does `activate-coordinated`
release the candidate. The controller commits after the external health gate;
until then it can park the target for a fail-closed peer rollback. Every phase is
atomically journaled in `gateway-handoff.json`, allowing a restarted supervisor
to reconcile against the authoritative `current` pointer. A three-minute
deadline terminates an abandoned preparation and supervisor rather than
guessing protocol compatibility.

Each deploy also writes its generated dependency-impact manifest and runs a
continuous HTTP/WebSocket canary. Supervisor status reports accepted, queued,
retried and timed-out connections plus maximum backend wait, so handoff latency
and loss are directly observable.
