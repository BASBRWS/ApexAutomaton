# Solana opportunity map, v0.4.0

This map separates a working devnet action from ideas. Devnet activity has no
monetary value. A protocol address on devnet does not prove liquidity, demand,
revenue, or that an SDK version still matches the deployment.

| Route | Evidence and devnet status | Current agent capability | Next gate |
| --- | --- | --- | --- |
| Pump.fun token launch | [Official program documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md) lists the Pump program on devnet. | Create one SOL-paired V2 token for an approved venture; SDK instruction, simulation, caps, and persistent mint record. | Run a funded devnet integration test. Buy and sell need a separate quote, slippage, fee and position-accounting adapter. |
| NFT creation and utility | [Metaplex Core create guide](https://developers.metaplex.com/smart-contracts/core/create) uses devnet. | Create one Metaplex Core asset per approved venture with fixed SDK instruction, simulation, spend caps, and durable asset record. | Run a funded devnet integration test. Verify a marketplace with devnet order flow before calling it trading. |
| Lending and borrowing | [Project 0 SDK overview](https://docs.marginfi.com/typescript-sdk/overview) describes lending and leveraged loops; its current SDK docs state production and staging, no devnet deployment. | Proposal only; no invented APY or interest. | Find and verify a protocol deployment and markets on devnet, or deploy an isolated test program. Add collateral health, oracle age, rate and liquidation checks. |
| Perpetuals and leverage | A trading SDK or mainnet market is not evidence of an executable devnet market. | Proposal and risk tool only. | Verify devnet deployment, market depth and oracle; then implement strict margin, funding, liquidation and exposure policy. |
| Solana apps and payments | Program access and wallet authentication need a real customer and product. | Venture proposal with deliverable and human launch action. | Measure usage and verified receipts separately from paper trading and self-reported projections. |
| Token gated access and collectibles | Core assets can be proof of ownership for a membership or event. | Propose utility and mint after approval; no automated access service. | Ship a real service and check demand, then verify access and receipts. |
| Liquidity provision and swaps | A supported devnet pool with observable quotes and depth is required. | Venture proposal and risk plan. | Validate pool addresses, slippage, fee tiers, impermanent loss, and a bounded route. |
| Governance and on-chain bounties | Participation depends on a real issuer and verifiable task reward. | Venture deliverable and manual verification. | Verify eligibility and reward settlement; no self-reported bounty credit. |

The agent should compare expected net return after fees, spend, liquidity and
time, then propose a test with a stop condition. It must not treat an on-chain
transaction, a token mint, or an NFT listing as a sale. The wallet is hard
locked to devnet even when a venture idea refers to a mainnet product.
