# /state — committed runtime state

This directory holds the agent's persisted state, committed each cycle by the
heartbeat workflow. It is the agent's memory across ticks.

Files (created at runtime):

- `state.json` — cycle count, children, daily caps, recent tx signatures, and
  the maximisation score.
- `journal.ndjson` — the append-only journal (one JSON object per line). Never
  rewritten — this is the audit trail.
- `obituaries/` — one markdown file per death.
- `children/` — Phase 3. A child's **public** key is recorded in `state.json`;
  its **secret** key is written here as `*.secret.json` and is gitignored — it
  is never committed.
- `KILL` — create this file to engage the kill switch. The agent cannot create
  or delete it; only an operator can. Its presence stops the agent at the very
  start of a cycle, before any spend.

Everything here is operator-auditable. The agent may write its own state and
journal, but it may NOT write the constitution (`src/constitution/`).
