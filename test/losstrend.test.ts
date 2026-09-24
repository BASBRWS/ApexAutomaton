import { describe, expect, it } from 'vitest';
import { assessLossTrend } from '../src/losstrend.js';

describe('assessLossTrend', () => {
  it('is ok at the peak with recent gains', () => {
    const lt = assessLossTrend({ equityUsd: 100, peakEquityUsd: 100, recentPnls: [0.2, 0.1, 0.3] });
    expect(lt.level).toBe('ok');
    expect(lt.drawdownPct).toBe(0);
    expect(lt.lossStreak).toBe(0);
  });

  it('counts only the trailing losing streak', () => {
    const lt = assessLossTrend({ equityUsd: 100, peakEquityUsd: 100, recentPnls: [-1, 0.5, -0.2, -0.3] });
    expect(lt.lossStreak).toBe(2); // last two are negative; the -1 earlier is broken by +0.5
  });

  it('warns on a moderate drawdown', () => {
    const lt = assessLossTrend({ equityUsd: 95.5, peakEquityUsd: 100, recentPnls: [] });
    expect(lt.drawdownPct).toBeCloseTo(0.045);
    expect(lt.level).toBe('warn');
  });

  it('alarms on a deep drawdown', () => {
    const lt = assessLossTrend({ equityUsd: 92, peakEquityUsd: 100, recentPnls: [] });
    expect(lt.level).toBe('alarm'); // 8% > 7%
  });

  it('alarms on a long losing streak even with a small drawdown', () => {
    const lt = assessLossTrend({
      equityUsd: 99.5,
      peakEquityUsd: 100,
      recentPnls: [-0.1, -0.1, -0.1, -0.1, -0.1, -0.1],
    });
    expect(lt.lossStreak).toBe(6);
    expect(lt.level).toBe('alarm');
  });

  it('sums trailing PnL and reports the window', () => {
    const lt = assessLossTrend({ equityUsd: 100, peakEquityUsd: 100, recentPnls: [-1, 0.5, -0.25] });
    expect(lt.trailingPnlUsd).toBeCloseTo(-0.75);
    expect(lt.window).toBe(3);
  });
});
