#!/usr/bin/env bash
#
# Agent-callable self-deploy for OpenSession, with a last-known-good pin, a
# post-restart health gate, and (opt-in) auto-rollback.
#
# Modes:
#   self-deploy.sh [--sha <target>]   ff-only deploy to <target> (default
#                                     origin/main) + restart + health gate
#   self-deploy.sh --rollback-only    restart onto the last-known-good pin
#                                     (used by the watchdog after a bad deploy)
#   self-deploy.sh --watchdog-probe   one conservative health probe (run every
#                                     60s by opensession-watchdog.timer)
#
# Runs as the service user; systemctl goes through `sudo -n` (plain systemctl
# when already root), so a missing sudo grant fails fast instead of prompting.
# The opensession-self-deploy MCP tool launches this as a transient SYSTEM unit
# (sudo -n systemd-run) so the deploy/health-gate/rollback sequence survives
# the service restart it triggers — but the script is equally runnable
# standalone by a human.
#
# ROLLBACK POSTURE (read before flipping the env flag): going FORWARD is always
# `git merge --ff-only` — it aborts loudly on a dirty/diverged tree, exactly
# like deploy/deploy.sh. Going BACK is impossible via ff (the pin is an
# ancestor of HEAD), so a rollback requires `git reset --hard <pin>` — and on
# THIS box the deploy checkout is still the live SHARED checkout where sessions
# keep uncommitted work, making an automatic hard reset the forbidden trap
# (see AGENTS.md's shared-checkout rules). Therefore rollback only rewrites the
# tree when BOTH hold: the tree is clean AND the caller set
# OPENSESSION_DEPLOY_ALLOW_RESET=1 (the future dedicated deploy-only checkout
# sets it; the shared checkout must not). Otherwise the script marks
# "rollback-needed" in the result file and leaves the tree for a human.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${OPENSESSION_DEPLOY_CHECKOUT:-$(dirname "$SCRIPT_DIR")}"
STATE_DIR="${OPENSESSION_DEPLOY_STATE:-$HOME/.opensession-deploy}"
HEALTH_URL="${OPENSESSION_HEALTH_URL:-http://127.0.0.1:3850/api/health}"
ALLOW_RESET="${OPENSESSION_DEPLOY_ALLOW_RESET:-0}"
SERVICE_NAME="${OPENSESSION_SERVICE_NAME:-opensession.service}"

# Health gate: 30 x 2s = 60s budget, matching deploy.sh's post-restart gate.
HEALTH_TRIES=30
HEALTH_SLEEP=2

# Watchdog conservatism: only act while a self-deploy is fresh, and only after
# several consecutive failures (transient blips must not trigger a rollback).
WATCHDOG_WINDOW_SECS=900   # 15 min after the last self-deploy restart
WATCHDOG_FAIL_THRESHOLD=3

PIN_FILE="$STATE_DIR/last-known-good"
MARKER_FILE="$STATE_DIR/last-deploy-marker"
RESULT_FILE="$STATE_DIR/last-result.json"
RESULTS_DIR="$STATE_DIR/results"
FAIL_COUNT_FILE="$STATE_DIR/watchdog-fail-count"
LOG_FILE="$STATE_DIR/self-deploy.log"
WATCHDOG_LOG="$STATE_DIR/watchdog.log"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date +%s)"

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

MODE=deploy
TARGET="origin/main"
while [ $# -gt 0 ]; do
  case "$1" in
    --sha) TARGET="${2:?--sha needs a value}"; shift 2 ;;
    --rollback-only) MODE=rollback; shift ;;
    --watchdog-probe) MODE=probe; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[self-deploy] unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

mkdir -p "$STATE_DIR" "$RESULTS_DIR"

# One self-deploy at a time: concurrent deploys race the pin (the second call
# would pin the first call's UNVERIFIED target as last-known-good). Probes skip
# instead of queueing — while a deploy holds the lock, its own health gate owns
# the window and a queued probe would just double-count.
exec 9>"$STATE_DIR/.lock"
if ! flock -n 9; then
  case "$MODE" in
    probe) exit 0 ;;
    *)
      echo "[self-deploy] another self-deploy/rollback is in flight (lock at $STATE_DIR/.lock) — refusing" >&2
      exit 1
      ;;
  esac
fi

log() { echo "[self-deploy] $(date -u +%H:%M:%S) $*"; }

# A set -e abort after the tree moved but before any write_result leaves the
# agent blind (stale result + open marker). Record an honest failure result for
# THIS run; deliberate exit-after-write paths are untouched (plain `exit`
# never trips ERR).
on_err() {
  local rc=$?
  set +e
  if ! grep -q "\"startedAt\":\"$STARTED_AT\"" "$RESULT_FILE" 2>/dev/null; then
    write_result false "$MODE" "$(git_repo rev-parse HEAD 2>/dev/null || echo unknown)" "" \
      "aborted by error (exit $rc) — see $LOG_FILE"
  fi
  exit "$rc"
}
trap on_err ERR

run_systemctl() {
  if [ "$(id -u)" = "0" ]; then systemctl "$@"; else sudo -n systemctl "$@"; fi
}

git_repo() { git -C "$REPO_DIR" "$@"; }

tree_clean() { [ -z "$(git_repo status --porcelain 2>/dev/null)" ]; }

health_ok() { curl -fs --max-time 4 "$HEALTH_URL" >/dev/null 2>&1; }

# Poll the health endpoint until it answers or the budget runs out. A single
# 200 can be a crash-looping instance's brief liveness window, so the gate
# demands HEALTH_CONSECUTIVE straight successes from the SAME process — a
# bootId change between probes means it restarted underneath us and the streak
# starts over.
HEALTH_CONSECUTIVE=3
poll_health() {
  local i ok=0 boot="" b body
  for i in $(seq 1 "$HEALTH_TRIES"); do
    sleep "$HEALTH_SLEEP"
    if body="$(curl -fs --max-time 4 "$HEALTH_URL" 2>/dev/null)"; then
      b="$(printf '%s' "$body" | grep -o '"bootId":"[^"]*"' | head -1 || true)"
      if [ -n "$boot" ] && [ "$b" != "$boot" ]; then ok=0; fi
      boot="$b"
      ok=$((ok + 1))
      if [ "$ok" -ge "$HEALTH_CONSECUTIVE" ]; then return 0; fi
    else
      ok=0
      boot=""
    fi
  done
  return 1
}

# Restart the service. The deploy marker is written ONLY by the deploy path
# (write_marker below), never by rollback restarts — the marker is what opens
# the watchdog's act window, and a rollback must close that window, not renew
# it (otherwise an unhealthy pin would loop restart→probe→rollback forever).
restart_service() {
  log "restarting ${SERVICE_NAME}"
  run_systemctl restart "$SERVICE_NAME"
}

# Opening the window also zeroes the consecutive-failure counter: a stale
# nonzero count from a pre-existing outage plus a fresh marker would otherwise
# let the very first failed probe cross the threshold and roll back instantly.
write_marker() {
  date +%s > "$MARKER_FILE"
  echo 0 > "$FAIL_COUNT_FILE"
}

# write_result <ok> <action> <sha> <previous_sha> <message>
# Result JSON is the contract deploy_status (src/server/self-deploy.ts) reads;
# keep the field names in sync with parseDeployResult there.
write_result() {
  local ok="$1" action="$2" sha="$3" previous="$4" message="$5"
  local finished_at duration tmp
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration=$(( $(date +%s) - STARTED_EPOCH ))
  tmp="$RESULT_FILE.tmp.$$"
  printf '{"ok":%s,"action":"%s","sha":"%s","previousSha":"%s","target":"%s","startedAt":"%s","finishedAt":"%s","durationSecs":%s,"message":"%s"}\n' \
    "$ok" "$action" "$sha" "$previous" "$TARGET" "$STARTED_AT" "$finished_at" "$duration" "$message" > "$tmp"
  mv "$tmp" "$RESULT_FILE"
  cp "$RESULT_FILE" "$RESULTS_DIR/$(date -u -d "@$STARTED_EPOCH" +%Y%m%dT%H%M%SZ 2>/dev/null || date -u +%Y%m%dT%H%M%SZ)-$action.json"
}

# Best-effort dependency sync after a tree change (deploy.sh's fast path).
maybe_bun_install() {
  if ! git_repo diff --quiet 'HEAD@{1}' HEAD -- bun.lock package.json 2>/dev/null; then
    if command -v bun >/dev/null 2>&1; then
      log "deps changed — bun install --frozen-lockfile"
      (cd "$REPO_DIR" && bun install --frozen-lockfile)
    else
      log "WARNING: deps changed but bun is not on PATH — skipping install"
    fi
  fi
}

# Restart onto the last-known-good pin (shared by the failed-deploy path and
# --rollback-only). Sets ROLLBACK_HEALTHY / ROLLBACK_DID_RESET; returns 0 when
# the service came back healthy, 1 otherwise.
rollback_to_pin() {
  ROLLBACK_HEALTHY=0
  ROLLBACK_DID_RESET=0
  if [ ! -f "$PIN_FILE" ]; then
    log "ERROR: no last-known-good pin at $PIN_FILE — cannot roll back"
    return 1
  fi
  local pin head_now
  pin="$(cat "$PIN_FILE")"
  head_now="$(git_repo rev-parse HEAD)"
  if [ "$head_now" = "$pin" ]; then
    # Already on the pin — the process is unhealthy, not the tree. Restart only.
    log "HEAD already at pin ${pin:0:10} — restarting without touching the tree"
  elif tree_clean && [ "$ALLOW_RESET" = "1" ]; then
    # The pin is an ancestor of HEAD, so ff backwards is impossible —
    # `git reset --hard` is the only way to move the tree back. It is safe
    # here ONLY because both gates held: the tree is clean (no session work to
    # destroy) and the caller explicitly opted in with
    # OPENSESSION_DEPLOY_ALLOW_RESET=1 (deploy-only checkout). See the header.
    log "rolling back tree: git reset --hard ${pin:0:10} (clean tree + OPENSESSION_DEPLOY_ALLOW_RESET=1)"
    git_repo reset --hard "$pin"
    ROLLBACK_DID_RESET=1
    maybe_bun_install
  else
    log "NOT resetting the tree: clean=$(tree_clean && echo yes || echo no) allow_reset=$ALLOW_RESET"
    log "rollback to ${pin:0:10} needs a human (or OPENSESSION_DEPLOY_ALLOW_RESET=1 on a clean deploy-only checkout)"
    write_result false rollback-needed "$head_now" "$pin" \
      "unhealthy after deploy; tree left at $head_now — roll back to pin $pin manually"
    return 1
  fi
  restart_service
  if poll_health; then
    ROLLBACK_HEALTHY=1
    log "healthy after rollback restart"
    return 0
  fi
  log "ERROR: still unhealthy after rollback restart"
  return 1
}

do_deploy() {
  # Everything below logs to the state dir as well as stdout (standalone runs
  # get a persistent trail; the transient unit's own append log catches any
  # bash error that happens before this line).
  exec > >(tee -a "$LOG_FILE") 2>&1
  log "deploy → $TARGET (repo $REPO_DIR, state $STATE_DIR)"

  log "fetching origin"
  git_repo fetch --prune origin

  local target_sha current
  if ! target_sha="$(git_repo rev-parse "${TARGET}^{commit}" 2>/dev/null)"; then
    log "ERROR: cannot resolve target '$TARGET'"
    exit 1
  fi
  current="$(git_repo rev-parse HEAD)"

  # Pin the pre-deploy HEAD as last-known-good BEFORE moving anything: this is
  # what --rollback-only and the watchdog restore.
  echo "$current" > "$PIN_FILE"
  log "pinned last-known-good ${current:0:10}"

  # Fast-forward only — never reset --hard going forward. Exactly deploy.sh's
  # philosophy: the checkout may be shared and sessions edit/commit on it
  # directly; ff-only advances cleanly when on main and ABORTS loudly if the
  # checkout diverged or has conflicting local edits — surface, don't destroy.
  if ! git_repo merge --ff-only "$target_sha"; then
    log "ERROR: cannot fast-forward to $TARGET ($target_sha)."
    log "The checkout has local commits or uncommitted changes. On the box:"
    log "  cd $REPO_DIR && git status   # then commit+push, or stash, then re-run"
    write_result false deploy "$current" "$current" "ff-only merge to $target_sha aborted — checkout diverged or dirty"
    exit 1
  fi

  maybe_bun_install

  # Open the watchdog window just before the restart, so the watchdog only
  # ever acts on failures caused by THIS deploy.
  write_marker
  restart_service

  if poll_health; then
    log "healthy after restart — deployed ${target_sha:0:10}"
    write_result true deploy "$target_sha" "$current" "deployed and healthy"
    echo 0 > "$FAIL_COUNT_FILE"
    exit 0
  fi

  log "ERROR: not healthy within $((HEALTH_TRIES * HEALTH_SLEEP))s after restart — attempting rollback to pin"
  if rollback_to_pin; then
    write_result false deploy "$(git_repo rev-parse HEAD)" "$current" \
      "deploy of $target_sha unhealthy; rolled back (reset=$ROLLBACK_DID_RESET) and healthy again"
  elif [ ! -f "$RESULT_FILE" ] || ! grep -q '"action":"rollback-needed"' "$RESULT_FILE" 2>/dev/null; then
    write_result false deploy "$(git_repo rev-parse HEAD)" "$current" \
      "deploy of $target_sha unhealthy; rollback attempted but service still unhealthy"
  fi
  exit 1
}

do_rollback() {
  exec > >(tee -a "$LOG_FILE") 2>&1
  TARGET="last-known-good"
  log "rollback-only (repo $REPO_DIR, state $STATE_DIR)"
  local previous
  previous="$(git_repo rev-parse HEAD 2>/dev/null || echo unknown)"
  if rollback_to_pin; then
    write_result true rollback "$(git_repo rev-parse HEAD)" "$previous" "restarted onto last-known-good and healthy"
    exit 0
  fi
  if ! grep -q '"action":"rollback-needed"' "$RESULT_FILE" 2>/dev/null; then
    write_result false rollback "$(git_repo rev-parse HEAD 2>/dev/null || echo unknown)" "$previous" \
      "rollback restart did not become healthy"
  fi
  exit 1
}

# One watchdog probe. NEVER acts outside a recent self-deploy window: the
# last-deploy-marker (written only by the deploy path, consumed here) must be
# younger than WATCHDOG_WINDOW_SECS, and WATCHDOG_FAIL_THRESHOLD consecutive
# probes must have failed. Outside the window it only counts — a generic
# outage is left to Restart=always and humans, never an automatic rollback.
do_probe() {
  if health_ok; then
    # Reset the consecutive-failure counter; skip the write when already 0 so
    # a healthy box doesn't churn the state dir every minute.
    if [ -s "$FAIL_COUNT_FILE" ] && [ "$(cat "$FAIL_COUNT_FILE")" != "0" ]; then
      echo 0 > "$FAIL_COUNT_FILE"
    fi
    exit 0
  fi
  local count marker now age
  count="$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)"
  case "$count" in (*[!0-9]*|'') count=0 ;; esac
  count=$((count + 1))
  echo "$count" > "$FAIL_COUNT_FILE"
  echo "[watchdog] $(date -u +%Y-%m-%dT%H:%M:%SZ) health probe failed (consecutive: $count)" >> "$WATCHDOG_LOG"

  marker="$(cat "$MARKER_FILE" 2>/dev/null || echo '')"
  case "$marker" in (*[!0-9]*|'') exit 0 ;; esac   # no (valid) deploy window — count only
  now="$(date +%s)"
  age=$((now - marker))
  if [ "$age" -gt "$WATCHDOG_WINDOW_SECS" ]; then exit 0; fi
  if [ "$count" -lt "$WATCHDOG_FAIL_THRESHOLD" ]; then exit 0; fi

  # Consume the window BEFORE acting: at most one automatic rollback per
  # deploy. If the pin itself is unhealthy we stop here and leave it to humans.
  echo "[watchdog] $(date -u +%Y-%m-%dT%H:%M:%SZ) acting: ${count} consecutive failures within ${age}s of a self-deploy — rollback-only" >> "$WATCHDOG_LOG"
  rm -f "$MARKER_FILE"
  echo 0 > "$FAIL_COUNT_FILE"
  do_rollback
}

case "$MODE" in
  deploy) do_deploy ;;
  rollback) do_rollback ;;
  probe) do_probe ;;
esac
