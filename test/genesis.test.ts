import { describe, expect, it } from 'vitest';
import { initUnfundedDesk, fundDesk, isFunded, equityUsd } from '../src/trading/desk.js';
import { genesisCapitalUsd } from '../src/config.js';
import { equityToSol } from '../src/economy.js';
import { makeTestConfig } from './helpers.js';

describe('genesis: SOL-denominated stake', () => {
  it('a fresh book is unfunded until it sees a price', () => {
    const d = initUnfundedDesk();
    expect(isFunded(d)).toBe(false);
    expect(d.cashUsd).toBe(0);
    expect(d.capitalUsd).toBe(0);
  });

  it('funds the book at 1 SOL worth, priced at the live SOL price', () => {
    const cfg = makeTestConfig(); // capitalSol = 1.0, no USD override
    const solPrice = 150;
    const capUsd = genesisCapitalUsd(cfg, solPrice);
    expect(capUsd).toBe(150);

    const d = fundDesk(initUnfundedDesk(), capUsd, 1);
    expect(isFunded(d)).toBe(true);
    expect(d.cashUsd).toBe(150);
    expect(d.capitalUsd).toBe(150);
    // Equity in SOL at genesis is exactly the SOL stake.
    expect(equityToSol(equityUsd(d, { SOL: solPrice }), solPrice)).toBeCloseTo(1.0, 9);
  });

  it('honours a fixed-USD override when set', () => {
    const cfg = makeTestConfig({
      trading: { ...makeTestConfig().trading, capitalUsdOverride: 500 },
    });
    expect(genesisCapitalUsd(cfg, 150)).toBe(500);
  });

  it('scales the stake with a different capitalSol', () => {
    const cfg = makeTestConfig({
      trading: { ...makeTestConfig().trading, capitalSol: 2.5 },
    });
    expect(genesisCapitalUsd(cfg, 120)).toBe(300);
  });
});
