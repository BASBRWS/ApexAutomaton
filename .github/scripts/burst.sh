#!/usr/bin/env bash
#
# burst.sh — the reliable heartbeat, decoupled from GitHub's flaky cron.
#
# ONE workflow run does a BURST: a cycle every BURST_INTERVAL_SECONDS for up to
# BURST_CYCLES cycles, committing + pushing state after each. So a SINGLE
# successful trigger keeps cycles flowing for hours — surviving a cron drought
# that would otherwise skip the schedule entirely.
#
# A stale-guard at the top makes overlapping/queued runs cheap no-ops: if a cycle
# ran less than STALE_SECONDS ago, another burst is already covering us, so exit.
# Combined with a shared `concurrency` group (only one burst runs at a time), the
# heartbeat and the watchdog never double-tick.
#
# Death (tick exit 1) ends the burst but is NOT a job failure. A real error (any
# other non-zero) ends the burst and is annotated for the Actions log.

set -uo pipefail

STALE_SECONDS="${STALE_SECONDS:-780}"        # 13 min: skip if a cycle ran more recently
BURST_CYCLES="${BURST_CYCLES:-8}"            # cycles per burst (8 x 15min ~= 2h autonomous)
BURST_INTERVAL_SECONDS="${BURST_INTERVAL_SECONDS:-900}"  # 15 min between cycles

git config user.name "automaton-bot"
git config user.email "automaton-bot@users.noreply.github.com"

cycle_age_seconds() {
  local last now then_ts
  last=$(jq -r '.lastRunAt // empty' state/state.json 2>/dev/null || true)
  if [ -z "$last" ]; then echo 999999; return; fi
  now=$(date +%s)
  then_ts=$(date -d "$last" +%s 2>/dev/null || echo 0)
  echo $(( now - then_ts ))
}

age=$(cycle_age_seconds)
if [ "$age" -lt "$STALE_SECONDS" ]; then
  echo "A cycle ran ${age}s ago (< ${STALE_SECONDS}s) — another burst is active; skipping."
  exit 0
fi
echo "Last cycle ${age}s ago — starting a burst of up to ${BURST_CYCLES} cycles, one per ${BURST_INTERVAL_SECONDS}s."

# Ask the Pages workflow to redeploy. Our own state pushes use GITHUB_TOKEN, and
# pushes made with that token do NOT trigger other workflows — so without this the
# dashboard would only refresh when the (now ~2h) burst finishes. workflow_dispatch
# IS allowed to run from GITHUB_TOKEN, so we dispatch it explicitly each cycle.
dispatch_pages() {
  if [ -z "${GH_TOKEN:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ]; then
    return
  fi
  if curl -sS -o /dev/null -w '%{http_code}' -X POST \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/pages.yml/dispatches" \
      -d '{"ref":"main"}' | grep -q '^204$'; then
    echo "Requested a Pages redeploy."
  else
    echo "::warning::Pages redeploy dispatch failed (non-fatal); dashboard will catch up later."
  fi
}

push_state() {
  git add state/ SOUL.md || true
  if git diff --cached --quiet; then
    echo "No state changes to commit."
    return
  fi
  git commit -m "$1" || true
  # Reconcile with any external commit (rare — our workflows are serialized).
  git pull --rebase --autostash origin main || true
  local a
  for a in 1 2 3 4; do
    if git push; then
      dispatch_pages
      return
    fi
    echo "push failed; retry $a"
    sleep $(( a * 2 ))
  done
  echo "::warning::state push failed after retries; will retry on the next cycle."
}

for i in $(seq 1 "$BURST_CYCLES"); do
  echo "::group::burst cycle ${i}/${BURST_CYCLES}"
  npm run --silent tick
  code=$?
  push_state "heartbeat: burst cycle ${i}/${BURST_CYCLES}"
  echo "::endgroup::"

  if [ "$code" = "1" ]; then
    echo "::warning::The automaton died this cycle (equity <= dust). Ending burst. See state/obituaries."
    break
  fi
  if [ "$code" != "0" ]; then
    echo "::error::tick exited ${code} (not a death) — ending burst. Check secrets/config and the logs above."
    break
  fi
  if [ "$i" -lt "$BURST_CYCLES" ]; then
    sleep "$BURST_INTERVAL_SECONDS"
  fi
done

echo "Burst complete."
exit 0
