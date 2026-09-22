# Apex Automaton

A **growth-seeking autonomous agent** that owns a real Solana wallet on
**devnet**. Its objective is to grow its net SOL balance as much as possible.
Running out of SOL kills it — but survival is the *floor*, not the goal.

Every Solana operation is a **real on-chain transaction**, but the cluster is
**hard-locked to devnet**, so the SOL has no monetary value and nothing is at
financial risk. This is *mortality engineering*: behaviour is shaped by the
conditions of the agent's death (balance = 0) **and** by an explicit growth
objective — not by survival pressure alone.

> ### The honest reality
> Most "autonomous money-making agents" earn nothing. That is exactly why this
> runs on devnet — the full loop (owning a wallet, proposing transactions,
> signing under policy, earning, burning compute, dying) is proven end-to-end at
> **zero risk** — and exactly why the objective is made **explicit** and a
> **score** is kept: so you can see whether the agent is genuinely *earning* or
> merely *surviving*. Going to mainnet is deliberately **not** implemented (see
> [No mainnet, by design](#no-mainnet-by-design)).

---

## Why the objective is explicit (and why survival pressure alone is not enough)

An instruction-following LLM agent does not optimise a numeric reward the way an
RL policy does — it does what its constitution/prompt tells it to. Survival
pressure *on its own* selects for the **cheapest way not to die**: minimal
inference, no risk, idling in a low tier. To actually get "earn as much as
possible", three things must be true, and this project builds all three:

1. **The objective is stated** — in the constitution and every prompt: *grow net
   balance; do not idle to preserve it*.
2. **More money buys more capability** — tiers are a **gradient, not a ceiling**:
   surplus unlocks better models, more tools, faster heartbeats, and eventually
   replication. So there is always a reason to climb.
3. **Growth is measured and selected for** — `score.ts` tracks peak balance,
   cumulative revenue, margin per task, and net growth every cycle; Phase 3
   selection lets the highest earners reproduce.

### Is growth *guaranteed*? No — and here is how it is secured anyway

Growth is not automatic. It rests on a hard economic condition and a soft
behavioural one:

- **Economic (secured in code).** Growth is only *possible* when one task pays
  more than the worst-case cost of the cycle that decides to do it
  (`reward > SOL_PER_USD × estimated_max_cycle_cost`). The shipped defaults
  satisfy this, and the **growth-guard test** (`test/growth-guard.test.ts`)
  **fails the build** if the configured economy is net-negative. There is a real
  trap here: higher tiers use the frontier model and therefore burn *more*, so a
  naïve reward can be net-negative exactly when the agent is healthiest. The
  defaults keep the reward comfortably above even the frontier cycle cost.
- **Behavioural (steered, then selected).** Whether the agent *chooses* to earn
  is steered by the prompt, the tier gradient, and the honest score. In Phase 1
  (a single agent) that is soft. The structural guarantee is **Phase 3
  selection**: over a population, only the highest earners reach SOVEREIGN and
  reproduce, so the strategies that earn most spread — selection does the
  maximising.

---

## How it works — the cycle

One run of `npm run tick` is one heartbeat (one cycle) in `src/loop.ts`:

```
observe prices → think → trade → burn → heartbeat → score → persist → decide
```

1. Load state (incl. the trading book), constitution, SOUL.md, a digest of recent
   journal + obituaries, and the score.
2. Fetch **real market prices**; mark the book to market and compute its equity
   (USD, and in SOL for the tier).
3. If **DEAD** (book equity in SOL ≤ `TRADING_DUST_SOL`): write an obituary,
   persist, `exit(1)`. Never self-resurrect.
4. Select the model, compute budget, tools, and rights for the tier.
5. Prompt the LLM (constitution + soul + prices + book + score + tools) for **one**
   next action. The framing: *grow your book; the market decides, not you.*
6. Execute the tool — usually `trade` (set target exposures at the real prices).
7. **Burn:** deduct this cycle's real LLM USD cost from the book. Then do one tiny
   **on-chain heartbeat** transfer on devnet (policy-gated) as proof-of-life.
8. **Update score** (equity, peak, net PnL), append to the journal.
9. Update SOUL.md only if the agent chose to. Persist state. End tick.

## Survival tiers — a gradient, not a ceiling

The tier is set by the book's equity **expressed in SOL** (equity USD ÷ live SOL
price), so a bigger book buys a better mind and more budget:

| Tier      | Equity (SOL) | Model    | Compute budget | Tools                     | Rights            |
|-----------|--------------|----------|----------------|---------------------------|-------------------|
| DEAD      | book ≤ dust  | —        | —              | —                         | stop              |
| CRITICAL  | dust – 0.1   | cheapest | minimal        | trade / rest only         | —                 |
| LOW       | 0.1 – 0.5    | cheaper  | reduced        | core, sheds non-essential | —                 |
| NORMAL    | 0.5 – 2.0    | frontier | standard       | full                      | —                 |
| ABUNDANT  | 2.0 – 5.0    | frontier | expanded       | full + premium            | faster heartbeat  |
| SOVEREIGN | > 5.0        | frontier | maximal        | full + premium            | may replicate     |

Thresholds and budgets are configurable starting points — tune them so a cycle
costs enough to feel pressure but not so much that the agent dies in a few ticks.

## How the agent earns: paper trading against REAL prices

The agent grows a **paper trading book** against **live market prices** — the
real market decides whether a trade worked, never the agent itself. **No real
funds are ever at risk.**

- Each cycle it fetches real prices (`src/marketdata.ts`: keyless Coinbase spot,
  CoinGecko fallback), with each price's change vs the previous cycle, across a
  **broad universe** (majors, L2s, Solana-ecosystem tokens, tokenised gold — set
  `TRADING_ASSETS`, extend `COINGECKO_IDS`). It then acts via two tools: `trade`
  (set per-asset USD exposure — long/short/flat) or `rebalance` (a whole target
  portfolio as weights). Full freedom of strategy within the gross-exposure cap;
  the market is the judge.
- The **book** (`src/trading/desk.ts`) is a pure, marked-to-market portfolio in
  USD. The whole game is **denominated in SOL**: it starts at
  `PAPER_TRADING_CAPITAL_SOL` SOL (default **1 SOL**), priced to USD once at
  genesis with the live SOL/USD price, and its goal is to grow that back into
  more SOL. (Set `PAPER_TRADING_CAPITAL_USD` to pin a fixed USD stake instead.)
  Positions are quoted in USD (the market's unit); equity is reported in both.
- **Compute burn:** the real USD cost of each LLM call (tokens × `src/llm/pricing.ts`)
  is deducted from the book every cycle. Resting in cash still burns — doing
  nothing is slow death.
- **Death is economic:** if book equity (in SOL) falls to `TRADING_DUST_SOL`, the
  agent writes an obituary and exits. There is **no guaranteed income** — if it
  can't trade profitably faster than it burns, it dies. Exactly like a real trader.
- **On-chain heartbeat:** every cycle still does one tiny **real devnet**
  transaction (a memo tagging the cycle + equity), so the Solana loop is
  genuinely exercised and auditable — funded by the operator seed, decoupled from
  the (paper) economic game, and fully governed by the caps/allowlist/kill switch.
- The survival **tiers** are computed from the book's value expressed in SOL, so
  a bigger book buys a better model and more budget, and a shrinking one sheds
  them — the same gradient, now driven by trading P&L.

> **The honest limit.** This is a *model* of earning: real prices, paper fills,
> no real money. An autonomous LLM trader will often lose — that's the point of
> testing it at zero risk. Truly unconstrained, real-money, off-platform activity
> is deliberately **not** built (see [No mainnet, by design](#no-mainnet-by-design)).

## Safety rails (enforced in code, not just the prompt)

These live in `src/solana/signer.ts` and `src/config.ts`, and they **override
the growth objective** — maximisation is bounded by policy, never the reverse.

- **Allowlist** — `signer.ts` rejects any transfer whose destination is not the
  compute-provider, the market, or a known child account. *Ask before widening
  the allowlist.*
- **Caps** — `PER_TX_CAP_SOL` and `DAILY_CAP_SOL` (plus per-cycle and per-day tx
  counts) are refused regardless of tier or objective.
- **Kill switch** — set `KILL_SWITCH=1`, or create a `state/KILL` file, to stand
  the agent down at the very start of a cycle, before any spend. The agent cannot
  create or delete `state/KILL`.
- **Devnet assertion** — `assertDevnet()` runs at startup and at every
  connection; any mainnet endpoint throws and exits.
- **Key hygiene** — the keypair is loaded **only** in `signer.ts`, validated
  against `AGENT_PUBKEY`, never logged, never committed, never passed to the LLM.

The pure policy function `evaluatePolicy()` is unit-tested in
`test/signer-policy.test.ts` (allowlist + caps + kill switch reject bad txs).

## The agent never holds its key

The agent **proposes** a plain `TransferProposal` (`{ to, lamports, reason }`).
The signer — which contains **no LLM call** — builds the actual System-Program
transfer itself from that proposal, checks it against policy, and only then
signs and sends. The agent cannot smuggle extra instructions into a transaction.

---

## Devnet — how it works

Devnet is a full Solana cluster with **free, valueless SOL**. The signing and
transaction flow is byte-for-byte identical to mainnet, so the loop is genuinely
exercised — you just can't lose anything. Get free SOL via the operator seed
(`npm run seed`, which calls the devnet faucet). The agent itself has no faucet
tool, on purpose.

## Setup

Requires **Node 20+**.

```bash
npm install
```

Generate the three keypairs you need (agent, market, compute-provider):

```bash
npm run keygen          # run 3× — one per account; copy pubkeys/secrets aside
```

Now create your `.env`. Two ways:

- **Guided (recommended):** open the local setup wizard and fill in each key step
  by step — it validates them, blocks mainnet, checks the growth guard, and
  produces a correct `.env` to copy or download. It runs entirely in your browser
  (no network calls; your keys never leave the page):

  ```bash
  npx serve .            # then open http://localhost:3000/setup/
  ```

  Save its output as `.env` in the project root.

- **Manual:** `cp .env.example .env` and fill in the values yourself.

Either way you set (see `.env.example` for the full list):

- `AGENT_PUBKEY` / `AGENT_KEYPAIR` — the agent wallet (secret loaded only in the
  signer).
- `MARKET_PUBKEY` / `MARKET_KEYPAIR` — the account that pays the agent.
- `COMPUTE_PROVIDER_PUBKEY` — receives the compute burn.
- `ANTHROPIC_API_KEY` — for the LLM (not needed for `tick:dry`).

Seed both accounts with free devnet SOL:

```bash
npm run seed            # airdrops SEED_AIRDROP_SOL to the AGENT wallet
npm run seed:market     # airdrops MARKET_SEED_AIRDROP_SOL to the MARKET account
```

(If the faucet rate-limits, use https://faucet.solana.com with the pubkey.)

Run one cycle locally:

```bash
npm run tick            # a real cycle (LLM call + devnet txs)
npm run tick:dry        # a FREE cycle: mock LLM (no API cost), still real devnet
npm run tick:dry -- BTC 200            # dry cycle placing a specific paper trade
```

`tick:dry` exercises the whole loop — balance read, earning, on-chain burn,
scoring, journaling — with no Anthropic API call, so you can try it before
spending anything. It still needs the wallets set and funded (devnet is free).

Run the tests (includes the growth guard and the signer-policy rails):

```bash
npm test
```

## Watch it — dashboard & setup wizard

Two local pages, served without any dependency:

```bash
npm run setup       # the .env setup wizard  -> http://localhost:4173/setup/
npm run dashboard   # balance/score/population -> http://localhost:4173/dashboard/
```

Both open your browser automatically. The **setup wizard is local only** — it
handles secrets and is never published.

## Publish the dashboard to GitHub Pages (no VPS needed)

You don't need a server to watch the agent. Actions is your heartbeat; Pages is
your dashboard.

1. Repo **Settings → Pages → Source: “GitHub Actions.”** (Pages on a *private*
   repo needs a paid plan; a public repo is free.)
2. The `deploy-dashboard` workflow (`.github/workflows/pages.yml`) publishes the
   dashboard at `https://<you>.github.io/<repo>/`. It redeploys on every push to
   the default branch — **including the `/state` commits the heartbeat makes** —
   so the public dashboard stays current.

It publishes the dashboard, the committed `/state`, and the setup wizard. Child
secrets are never committed, so they never reach Pages. The setup wizard makes
**no network calls**, so anything typed into it stays in the visitor's browser;
it is also served `noindex`. (If you'd rather keep the wizard off the public
site, drop the `setup/**` copy step from `.github/workflows/pages.yml` — it then
stays local-only via `npm run setup`.)

## Enable the heartbeat (GitHub Actions)

`.github/workflows/heartbeat.yml` runs `npm run tick` on a cron and commits the
updated `/state` back to the repo. Add the same values as **repository secrets**
(Settings → Secrets and variables → Actions): `AGENT_PUBKEY`, `AGENT_KEYPAIR`,
`MARKET_PUBKEY`, `MARKET_KEYPAIR`, `COMPUTE_PROVIDER_PUBKEY`, `OPERATOR_PUBKEY`,
`ANTHROPIC_API_KEY`, and optionally `SOLANA_RPC_URL`.

### The Actions-cron limitation (important)

GitHub Actions cron is **coarse and best-effort**: the finest practical cadence
is ~5+ minutes, and scheduled runs are frequently **delayed** (sometimes by many
minutes) or skipped under load. It is **not** a truly continuous loop.

**Continuous alternative:** run `npm run tick` on a timer on a small VPS, a
`systemd` timer, or **Cloud Run** with Cloud Scheduler. Persist `/state` by
committing to the repo (as the workflow does) or wire up Firestore — the code
already reserves `FIRESTORE_*` for that (Phase 2).

## Where the controls live

| Control        | Location                                                     |
|----------------|--------------------------------------------------------------|
| Kill switch    | `KILL_SWITCH` env, or create `state/KILL`                     |
| Caps           | `PER_TX_CAP_SOL`, `DAILY_CAP_SOL`, `MAX_TX_PER_*` in `.env`   |
| Allowlist      | `src/solana/signer.ts` → `Signer.allowlist()`                |
| Devnet lock    | `src/config.ts` → `assertDevnet()`                           |
| Tier tuning    | `src/tiers.ts` + `TIER_*` env vars                           |
| Economy tuning | `SOL_PER_USD`, `MARKET_TASK_REWARD_SOL` in `.env`            |

## Repo layout

```
src/loop.ts            the ReAct cycle
src/economy.ts         balance, USD→SOL burn, on-chain settle
src/tiers.ts           balance thresholds → model, budget, tools, rights
src/score.ts           maximisation metrics
src/llm/               LLMClient interface + Anthropic impl + price table
src/solana/wallet.ts   devnet connection, balance, build/send transfer, seed airdrop
src/solana/signer.ts   the ONLY place the keypair loads; policy (allowlist + caps)
src/marketdata.ts      REAL read-only prices (Coinbase spot + CoinGecko fallback)
src/trading/desk.ts    the pure paper trading book (marked to market)
src/market.ts          legacy modeled market (kept; unused by the trading loop)
src/revenue/           Phase 2 — RevenueAdapter seam (market default, off-chain scaffold)
src/persistence/       Phase 2 — StateStore seam (file default, Firestore scaffold)
src/tools/             pluggable tool registry + tools (trade, write_journal, transfer, …)
src/constitution/      read-only law files, loaded each cycle
src/soul.ts            reads/writes SOUL.md
src/journal.ts         append-only journal + obituary writer
src/replication.ts     Phase 3 — code-driven child funded by a real devnet transfer
state/                 committed runtime state (cycle, children, journal, score, sigs)
dashboard/             Phase 3 scaffold — static HTML reading /state
.github/workflows/heartbeat.yml   the cron heartbeat
```

## Phases

- **Built:** full skeleton, loop, wallet + signer (devnet, allowlist, caps),
  six-tier gradient, `score.ts`, constitution, soul, journal, Actions heartbeat,
  `npm run tick` / `npm run seed`, and the **trading layer** — real prices
  (`marketdata.ts`), the paper book (`trading/desk.ts`), and the `trade` tool —
  with tests for the desk, price fallback, tiers, score, and the signer's policy.
- **Phase 2 (scaffolded, off by default):** richer task catalog; a `RevenueAdapter`
  seam (`src/revenue/`) with the devnet **market** adapter as default and an
  **off-chain** adapter scaffold behind `movesValue` (guards + TODOs, still
  devnet-settled — no real-value path); a value-moving `transfer` tool exposed
  only at NORMAL+ when `PHASE2_TOOLS_ENABLED=1` and fully policy-gated; a
  `StateStore` seam (`src/persistence/`) with the committed **file** store as
  default and a **Firestore** scaffold selected when `FIRESTORE_PROJECT_ID` is set.
- **Phase 3:** code-driven replication (`src/replication.ts`, enabled by
  `REPLICATION_ENABLED=1` — **on** in the hosted heartbeat/watchdog workflows) +
  the static dashboard (`dashboard/`), which shows the live **population** of
  offspring. Replication is SOVEREIGN-gated and conditioned only on **sustained
  profit** and the population cap — never on population size as a driver, never an
  LLM choice, and never decidable in the same context the agent uses to reason
  about death. Funding a child is an ordinary capped devnet transfer (keep
  `CHILD_SEED_SOL` ≤ `PER_TX_CAP_SOL`); a funding failure is noted, not fatal.

### Enabling Phase 2/3

Everything above is **off by default** — Phase 1 behaviour is unchanged unless
you opt in via env flags: `PHASE2_TOOLS_ENABLED`, `OFFCHAIN_REVENUE_ENABLED`,
`FIRESTORE_PROJECT_ID`, `REPLICATION_ENABLED` (see `.env.example`). The Firestore
and off-chain adapters are scaffolds: they carry the interface and guards but
throw/TODO where the real integration goes, so they can't be mistaken for
finished backends.

## No mainnet, by design

There is no mainnet code path. `assertDevnet()` runs at startup and at every
connection; any endpoint containing `mainnet` throws immediately. Making this
agent trade real value would require deliberately removing that lock — which this
project does not do and does not document how to do. The point is the *mechanism*,
proven safely.
