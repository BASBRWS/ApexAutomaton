# Apex Automaton v0.5.0

A **growth-seeking autonomous agent** that owns a real Solana wallet on
**devnet**. Its paper book aims to grow against live prices. The book controls
tiers and death. The separate devnet wallet pays transaction fees and proves
that on-chain operations work.

Every Solana operation is a **real on-chain transaction**, but the cluster is
checked against the devnet genesis hash before every signed operation. Devnet
SOL has no monetary value. Anthropic API calls still cost real money.

## Solana ventures: three on-chain routes on devnet

The venture prompt now considers DeFi lending tools, NFT utility, leverage risk
tools, token launches, Web3 apps and services alongside digital products. A
category can have at most three active or pending ventures, so the queue cannot
fill indefinitely with variations on one template. Each proposal must state a
deliverable and the human action needed to launch it. A devnet token or a draft
does **not** count as revenue; only separately reported sales enter the score.

The first on-chain protocol route is a **Pump.fun token creation on devnet**.
Its program is deployed on devnet. The agent can propose a venture with
`pumpToken` containing `name`, `symbol` and a public HTTPS URI for metadata JSON.
An operator checks the metadata and sets the proposal status to `approved` in
`state/ventures.json`. After the next tick makes it `active`, the agent can use
`pump_create` to create one token for that venture. The signer builds the Pump
instruction itself with the official SDK, checks the devnet genesis hash,
simulates the transaction, caps the wallet debit at `PUMP_MAX_CREATE_SOL` and
the existing per-transaction and daily limits, and records signed intent before
broadcast. It permits one launch per UTC day and saves the mint and signature
with the main state to stop duplicate launches after a partial save.

The second on-chain route is **Metaplex Core NFT creation on devnet**. A venture
can instead specify `nftAsset` with a name and a public HTTPS metadata JSON URI.
After the operator sets its status to `approved`, `nft_create` can make exactly
one asset for that venture. The signer constructs a fixed Core instruction,
simulates wallet debit, applies `NFT_MAX_CREATE_SOL` (default 0.03 SOL) and the
general caps, and persists the pending signature and confirmed asset address.
Minting an NFT does not mean that anyone purchased it or that revenue accrued.

An independent **Token-2022 mint** is a third route. A proposal specifies
`splToken` with `name`, `symbol`, a public HTTPS metadata URI and `decimals` from
0 to 9. Once you approve it, `spl_create` creates a mint with embedded on-chain
metadata and **zero supply**. No tokens are issued or sold. The signer checks
simulation and both `SPL_MAX_CREATE_SOL` and the general transaction limits,
then persists the signature and mint address against the approved venture.

Set `PUMP_DEVNET_ENABLED=1` to expose this route. The hosted heartbeat and
watchdog also set `NFT_DEVNET_ENABLED=1` and `SPL_DEVNET_ENABLED=1`; locally all
three flags default to off.
No proposal is approved automatically. Review the
metadata URI, name and symbol before setting `approved`. If confirmation is
uncertain, reconcile `pendingTransfer` on-chain before another value action.
No buy, sell, lending, leverage or NFT marketplace instructions are exposed yet.
See [Solana opportunity map](docs/solana-opportunities.md) for the next adapters
and the distinction between a devnet test and real demand.

> ### The honest reality
> Most "autonomous money-making agents" earn nothing. That is exactly why this
> runs on devnet — the full loop (owning a wallet, proposing transactions,
> signing under policy, earning, burning compute, dying) is proven end-to-end at
> **no real trading capital at risk** — API calls still cost money. The objective is **explicit** and a
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
   surplus unlocks better models and tools. Replication remains disabled until
   child agents can run independently.
3. **Growth is measured** — `score.ts` separates paper equity and reported
   venture revenue, and compares the paper book with holding SOL and cash.

### Is growth guaranteed?

No. The LLM chooses actions, and prices determine the paper result. Each fill
pays modeled fees, spread and slippage; shorts also pay modeled borrow cost.
The old fixed task reward and its growth guard belong to the unused legacy
market. Passing that test does not prove profitable trading.

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
   **on-chain heartbeat** memo transaction on devnet as proof-of-life.
8. **Update score** (equity, peak, net PnL), append to the journal.
9. Update SOUL.md only if the agent chose to. Persist state. End tick.

## Survival tiers — a gradient, not a ceiling

The tier is set by the book's equity expressed in SOL using the **genesis** SOL
price. Live SOL moves do not change the tier by themselves:

| Tier      | Equity (SOL) | Model    | Compute budget | Tools                     | Rights            |
|-----------|--------------|----------|----------------|---------------------------|-------------------|
| DEAD      | book ≤ dust  | —        | —              | —                         | stop              |
| CRITICAL  | dust – 0.1   | cheapest | minimal        | trade / stake / rest only | —                 |
| LOW       | 0.1 – 0.5    | cheapest | reduced        | core, sheds non-essential | —                 |
| NORMAL    | 0.5 – 2.0    | cheaper  | standard       | full                      | —                 |
| ABUNDANT  | 2.0 – 5.0    | cheaper  | expanded       | full + premium            | faster heartbeat  |
| SOVEREIGN | > 5.0        | frontier | maximal        | full + premium            | replication off   |

**The frontier mind is EARNED, not given.** A starting 2-SOL agent runs a capable
mid-tier model; only sustained growth to SOVEREIGN (5+ SOL) unlocks the frontier
model. This keeps the agent's intelligence a prize for survival — and makes your
real API spend a function of the agent's success, not a fixed subsidy. (Models map
via `MODEL_CHEAPEST` / `MODEL_CHEAPER` / `MODEL_FRONTIER`.)

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
  `PAPER_TRADING_CAPITAL_SOL` SOL (default **2 SOL**), priced to USD once at
  genesis with the live SOL/USD price, and its goal is to grow that back into
  more SOL. (Set `PAPER_TRADING_CAPITAL_USD` to pin a fixed USD stake instead.)
  Positions are quoted in USD (the market's unit); equity is reported in both.
- **Compute burn:** the real USD cost of each LLM call (tokens × `src/llm/pricing.ts`)
  is deducted from the book every cycle. Resting in cash still burns — doing
  nothing is slow death.
- **Yield sleeve:** `stake` parks paper capital. `YIELD_APY` defaults to zero.
  Setting a rate simulates yield; it does not establish a real yield source.
- **Death is economic:** if book equity (in SOL) falls to `TRADING_DUST_SOL`, the
  agent writes an obituary and exits. There is **no guaranteed income** — if it
  can't grow faster than it burns, it dies. Exactly like a real trader.
- **On-chain heartbeat:** every cycle still does one tiny **real devnet**
  transaction (a memo tagging the cycle + equity), so the Solana loop is
  genuinely exercised and auditable. It pays a real devnet fee from the operator
  seed. Memo transactions obey the kill switch and devnet check; transfer caps
  and destination allowlists apply only to value transfers.
- The survival **tiers** are computed from the book's value expressed in SOL, so
  a bigger book buys a better model and more budget, and a shrinking one sheds
  them — driven by paper P&L and any manually reported venture revenue.

> **The honest limit.** This is a *model* of earning: real prices, paper fills,
> no real money. An autonomous LLM trader will often lose — that's the point of
> testing it without real trading capital. Real API costs still apply. Off-platform activity
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
- **Devnet assertion** — a URL check runs at startup, then the connected
  cluster's genesis hash is checked before spending and before every signature.
- **Key hygiene** — the keypair is loaded **only** in `signer.ts`, validated
  against `AGENT_PUBKEY`, never logged, never committed, never passed to the LLM.

A value transfer is written to `state/state.json` as `pendingTransfer` before
it is broadcast. If confirmation or persistence fails, later value transfers
are blocked. Inspect that signature on the devnet explorer, reconcile whether
it landed and the day's caps, then remove `pendingTransfer` manually. Do not
remove it merely to make the next cycle run. Memo heartbeats remain separate.

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
  by step — it validates inputs and paper execution costs, and
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
- `MARKET_PUBKEY` / `MARKET_KEYPAIR` — optional legacy task market account.
- `COMPUTE_PROVIDER_PUBKEY` — optional transfer destination, not an API payment.
- `ANTHROPIC_API_KEY` — for the LLM (not needed for `tick:dry`).

Seed the agent account with free devnet SOL:

```bash
npm run seed            # airdrops SEED_AIRDROP_SOL to the AGENT wallet
npm run seed:market     # optional, for the legacy task market
```

(If the faucet rate-limits, use https://faucet.solana.com with the pubkey.)

Run one cycle locally:

```bash
npm run tick            # a real cycle (LLM call + devnet txs)
npm run tick:dry        # a FREE cycle: mock LLM (no API cost), still real devnet
npm run tick:dry -- BTC 200            # dry cycle placing a specific paper trade
```

`tick:dry` exercises the loop — price read, paper trading, on-chain memo,
scoring, journaling — with no Anthropic API call, so you can try it before
spending anything. It still needs the wallets set and funded (devnet is free).

Run the tests:

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

It publishes the dashboard and committed `/state`. The setup wizard is only
served locally. A public repository and its Pages state remain publicly readable.

## Enable the heartbeat (GitHub Actions)

`.github/workflows/heartbeat.yml` drives the cycles and commits the updated
`/state` back to the repo. Add the same values as **repository secrets**
(Settings → Secrets and variables → Actions): `AGENT_PUBKEY`, `AGENT_KEYPAIR`,
`MARKET_PUBKEY`, `MARKET_KEYPAIR`, `COMPUTE_PROVIDER_PUBKEY`, `OPERATOR_PUBKEY`,
`ANTHROPIC_API_KEY`, and optionally `SOLANA_RPC_URL`.

### Burst mode (working around the flaky cron)

GitHub Actions cron is **coarse and best-effort**: scheduled runs are frequently
**delayed** or skipped (we have seen multi-hour gaps). A naive "one trigger = one
cycle" loop is therefore not continuous.

So the heartbeat runs in **bursts** (`.github/scripts/burst.sh`): one trigger runs
a cycle every `BURST_INTERVAL_SECONDS` (default 15 min) for up to `BURST_CYCLES`
(default 8, ~2h), committing + pushing state after each. A **single** successful
trigger then keeps cycles flowing for hours, surviving a cron drought. A shared
`concurrency` group plus a stale-guard (`STALE_SECONDS`, default 13 min) means the
heartbeat and the offset **watchdog** never double-tick — overlapping triggers are
cheap no-ops. Tune the cadence/length by editing the `env:` block in the workflows.

**Fully-continuous alternative:** run `npm run tick` on a timer on a small VPS, a
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
- **Phase 3:** the replication code is a scaffold. It can create and fund a
  child account, but no child runner or strategy comparison exists. It is off
  in hosted workflows and enabling `REPLICATION_ENABLED=1` fails configuration.

### Enabling Phase 2/3

Everything above is **off by default** — Phase 1 behaviour is unchanged unless
you opt in via env flags: `PHASE2_TOOLS_ENABLED`, `OFFCHAIN_REVENUE_ENABLED`,
`FIRESTORE_PROJECT_ID` (see `.env.example`). The Firestore
and off-chain adapters are scaffolds: they carry the interface and guards but
throw/TODO where the real integration goes, so they can't be mistaken for
finished backends.

## No mainnet, by design

There is no mainnet trading path. Before signing, the code checks the connected
RPC genesis hash against the known devnet hash. The configured endpoint must
also look like devnet. A dishonest RPC server could lie about its identity, so
use a trusted endpoint. The paper book never settles a real market trade.
