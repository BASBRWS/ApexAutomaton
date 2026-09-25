# Release notes

## 0.5.1, 2026-09-25

- Restore the full journal as the default USD equity chart. Keep a separate live-price SOL view, which starts at cycle 185 because older entries used a fixed conversion price.
- Preserve a growing factual history in SOUL.md from the durable lessons ledger while keeping strategy notes concise. Show only recent history in each model prompt so memory growth does not make every cycle more expensive.

### Migration

The first cycle backfills the factual SOUL.md history from state/lessons.ndjson. Trading state, score and journal are unchanged.

## 0.5.0, 2026-09-25

- Add an operator-approved Token-2022 devnet mint with embedded on-chain metadata and zero initial supply. The signer builds four fixed instructions in one atomic transaction and checks simulation, `SPL_MAX_CREATE_SOL` and the existing caps.
- Persist signed intent and confirmed mint per venture to prevent duplicate creation after a partial save. Gate `spl_create` at NORMAL+ while an approved mint awaits creation.
- Show Token-2022 approvals and mint addresses in the dashboard, and extend the opportunity map and setup defaults.

### Migration

Existing state and ventures need no migration. A confirmed mint adds `splMints` to state. Set `SPL_DEVNET_ENABLED=1` locally and approve a venture with `splToken` metadata. Hosted workflows enable the feature, but no mint runs without approval. Keep `SPL_MAX_CREATE_SOL` at or below `PER_TX_CAP_SOL`.

### Known limits

The mint starts with zero supply. Issuance, transfers and marketplace execution need separate approval and accounting adapters. Metadata URI content needs operator review. A funded devnet mint has not been run from this environment.

## 0.4.0, 2026-09-25

- Add Metaplex Core devnet NFT creation for an operator-approved venture with public HTTPS metadata. The signer builds the fixed instruction, validates signers and program, simulates debit and enforces `NFT_MAX_CREATE_SOL` plus general transaction caps.
- Record a pending signature before broadcast and persist confirmed NFT assets by venture ID to block duplicate creation after partial saves. Gate the tool at NORMAL+ and expose it only while an approved venture awaits creation.
- Expand the Solana opportunity map with token gated access, liquidity provision and bounties; show devnet NFT approvals and results separately from live listings and reported revenue in the dashboard.

### Migration

Existing state and ventures require no migration. `nftAssets` is populated on the first confirmed asset creation. Local runs must explicitly set `NFT_DEVNET_ENABLED=1`; hosted workflows enable it, but creation still requires operator approval in `state/ventures.json`. Set `NFT_MAX_CREATE_SOL` at or below `PER_TX_CAP_SOL`.

### Known limits

NFT creation is not a sale and no devnet NFT marketplace, lending, leverage or liquidity adapter is implemented. A public metadata URI is syntactically checked, but its JSON content and availability must be reviewed by the operator. The SDK instruction was tested offline on Node 20; a funded devnet NFT mint has not been run from this environment. An ambiguous confirmation blocks later value actions pending reconciliation.

## 0.3.0, 2026-09-25

- Broaden the agent's venture search to Solana DeFi, NFT, token creation and Web3 products. Limit one category to three active or pending ventures.
- Add a Pump.fun devnet token creation route behind `PUMP_DEVNET_ENABLED`. Only an approved venture with name, symbol and HTTPS metadata URI can mint. The official SDK builds the instruction in the signer; the LLM cannot supply transaction bytes or extra signers.
- Simulate before signing, enforce the general transaction caps plus a 0.05 SOL default launch cap and one launch per UTC day. Persist a pending signature and a per-venture mint record to prevent ambiguous retries and duplicate launches.
- Add an opportunity map for lending, leverage, NFT and other Solana routes. None is presented as implemented trading or verified revenue.
- Value equity, tiers, death and the gross exposure cap using the observed SOL price. The genesis quote remains only for starting capital and the SOL-hold benchmark.

### Migration

Existing ventures and paper positions remain intact. `pumpMints` is added to state after the first launch. Set `PUMP_DEVNET_ENABLED=1` locally to expose `pump_create`; hosted workflows already set it. An operator must approve a venture with `pumpToken` metadata first. Review and host real metadata JSON at its HTTPS URI. `PUMP_MAX_CREATE_SOL` must be at most `PER_TX_CAP_SOL`.
Older journal entries retain their original frozen-price SOL values. New entries store the SOL quote used for valuation. The dashboard peak SOL tile starts its live-price series with this release.

### Known limits

Pump.fun creation is only a devnet mint and does not buy, sell or produce revenue. Transaction simulation estimates the wallet debit; program state can change between simulation and broadcast. A pending ambiguous transaction requires human reconciliation. Protocol lending, leverage and NFT marketplace execution are not implemented yet. No end-to-end devnet launch was performed from this repository environment.

## 0.2.0, 2026-09-24

- Restrict venture-live issues to the repository owner. Pass issue data as data instead of inserting it into shell and JavaScript source.
- Verify the Solana devnet genesis hash before each cycle, signature and airdrop. Reject confirmed transactions with an on-chain error. Persist the signed value-transfer intent before broadcasting; an ambiguous result blocks later transfers until reconciled.
- Stop the hosted burst when state cannot be rebased or pushed. Write the main state and venture book through temporary files, then rename them.
- Keep revenue credits with the main trading state to avoid counting reported venture sales twice after a partial save. A persisted death flag stops future cycles.
- Require a fresh SOL price to fund the paper book. A failed quote cannot be used to open a new paper trade; cached prices remain available for valuation.
- Model execution fees, spread, slippage and short borrow cost. Rebalancing now validates the whole target portfolio before changing it. Yield defaults to zero because it has no external yield source.
- Show paper equity, reported venture revenue, a cash baseline and a live SOL holding benchmark separately in the score and dashboard.
- Disable replication in hosted workflows and reject the flag until child agents have their own runner and measurable results.
- Keep the key setup wizard local. GitHub Pages publishes the dashboard and public state only.
- Update the setup wizard, environment example and README to describe the current paper trading loop.

### Migration

Existing state is loaded without resetting the book or cycle count. The first
new cycle adds the revenue credit ledger and comparison fields. Paper trades
placed after upgrading pay the new modeled execution costs. Existing positions
are retained. If you previously relied on simulated yield, set `YIELD_APY`
explicitly. `REPLICATION_ENABLED=1` must be removed or changed to `0`.

### Known limits

The trading fills are still a simulation using observed quotes and configured
cost estimates. Venue order books, margin calls, and real short borrow rates
are not modeled. A pending Solana transaction whose confirmation becomes
ambiguous still needs operator reconciliation before retrying a value transfer.
Reported venture revenue is manually entered and is not independently verified.
