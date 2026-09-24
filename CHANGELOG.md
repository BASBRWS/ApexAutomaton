# Release notes

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
