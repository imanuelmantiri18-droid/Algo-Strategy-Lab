import type { Candle, Signal, StrategyDef } from "../types/strategy";

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    if (i === 0) {
      out.push(v);
      prev = v;
    } else {
      const next = v * k + prev * (1 - k);
      out.push(next);
      prev = next;
    }
  }
  return out;
}

function rsi(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(50);
  if (values.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

const closes = (candles: Candle[]): number[] => candles.map((c) => c.c);

export const STRATEGIES: StrategyDef[] = [
  {
    id: "ema_cross",
    name: "EMA Crossover",
    tagline: "Classic trend follower riding fast/slow EMAs.",
    description:
      "Goes long when the fast EMA crosses above the slow EMA, exits when it crosses back. Smooth, lazy, trend-friendly.",
    category: "trend",
    risk: "medium",
    params: [
      { key: "fast", label: "Fast EMA", type: "number", default: 12, min: 3, max: 50, step: 1 },
      { key: "slow", label: "Slow EMA", type: "number", default: 30, min: 10, max: 200, step: 1 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const fast = ema(c, Math.max(2, Math.round(params.fast ?? 12)));
      const slow = ema(c, Math.max(3, Math.round(params.slow ?? 30)));
      const out: Signal[] = new Array(candles.length).fill(0);
      for (let i = 1; i < candles.length; i++) {
        out[i] = (fast[i] ?? 0) > (slow[i] ?? 0) ? 1 : -1;
      }
      return out;
    },
  },
  {
    id: "rsi_revert",
    name: "RSI Mean Reversion",
    tagline: "Buys fear, sells greed.",
    description:
      "Long when RSI dips below the oversold threshold; flat (or short) when RSI spikes above overbought.",
    category: "mean_reversion",
    risk: "medium",
    params: [
      { key: "period", label: "RSI Period", type: "number", default: 14, min: 5, max: 50, step: 1 },
      { key: "oversold", label: "Oversold", type: "number", default: 30, min: 5, max: 45, step: 1 },
      { key: "overbought", label: "Overbought", type: "number", default: 70, min: 55, max: 95, step: 1 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const r = rsi(c, Math.max(3, Math.round(params.period ?? 14)));
      const oversold = params.oversold ?? 30;
      const overbought = params.overbought ?? 70;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 1; i < candles.length; i++) {
        const v = r[i] ?? 50;
        if (v < oversold) pos = 1;
        else if (v > overbought) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  {
    id: "breakout",
    name: "Donchian Breakout",
    tagline: "Buys new highs, sells new lows.",
    description:
      "Long when price breaks above the N-day high; short when it breaks below the N-day low. Classic turtle-style.",
    category: "breakout",
    risk: "high",
    params: [
      { key: "lookback", label: "Channel Length", type: "number", default: 20, min: 5, max: 100, step: 1 },
    ],
    generateSignals(candles, params) {
      const lb = Math.max(2, Math.round(params.lookback ?? 20));
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = lb; i < candles.length; i++) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i - lb; j < i; j++) {
          hi = Math.max(hi, candles[j]?.h ?? -Infinity);
          lo = Math.min(lo, candles[j]?.l ?? Infinity);
        }
        const cur = candles[i]?.c ?? 0;
        if (cur > hi) pos = 1;
        else if (cur < lo) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  {
    id: "momentum",
    name: "N-Day Momentum",
    tagline: "Trade in the direction of recent returns.",
    description:
      "Long when the last N-day return is positive, short when negative. Pure trend persistence bet.",
    category: "momentum",
    risk: "medium",
    params: [
      { key: "lookback", label: "Lookback (days)", type: "number", default: 10, min: 2, max: 60, step: 1 },
      {
        key: "threshold",
        label: "Min |Return| %",
        type: "number",
        default: 1.5,
        min: 0,
        max: 20,
        step: 0.1,
        description: "Skip flat markets below this absolute return",
      },
    ],
    generateSignals(candles, params) {
      const lb = Math.max(2, Math.round(params.lookback ?? 10));
      const thr = (params.threshold ?? 1.5) / 100;
      const out: Signal[] = new Array(candles.length).fill(0);
      for (let i = lb; i < candles.length; i++) {
        const past = candles[i - lb]?.c ?? candles[i]?.c ?? 1;
        const cur = candles[i]?.c ?? past;
        const ret = cur / past - 1;
        if (ret > thr) out[i] = 1;
        else if (ret < -thr) out[i] = -1;
        else out[i] = out[i - 1] ?? 0;
      }
      return out;
    },
  },
  {
    id: "moonshot",
    name: "Moonshot",
    tagline: "High-leverage trend-rider chasing 1000% APY.",
    description:
      "Combines a fast trend filter (EMA20 vs EMA50) with momentum confirmation. Designed to be paired with high leverage and a tight stop / wide take-profit. Extreme risk: full account loss possible.",
    category: "moonshot",
    risk: "extreme",
    params: [
      { key: "fast", label: "Fast EMA", type: "number", default: 8, min: 3, max: 30, step: 1 },
      { key: "slow", label: "Slow EMA", type: "number", default: 21, min: 10, max: 80, step: 1 },
      { key: "momLookback", label: "Momentum Lookback", type: "number", default: 5, min: 2, max: 30, step: 1 },
      {
        key: "allowShort",
        label: "Allow Shorts (1=yes 0=no)",
        type: "number",
        default: 1,
        min: 0,
        max: 1,
        step: 1,
      },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const fast = ema(c, Math.max(2, Math.round(params.fast ?? 8)));
      const slow = ema(c, Math.max(3, Math.round(params.slow ?? 21)));
      const mLb = Math.max(2, Math.round(params.momLookback ?? 5));
      const allowShort = (params.allowShort ?? 1) > 0.5;
      const out: Signal[] = new Array(candles.length).fill(0);
      for (let i = mLb; i < candles.length; i++) {
        const trendUp = (fast[i] ?? 0) > (slow[i] ?? 0);
        const past = c[i - mLb] ?? c[i] ?? 1;
        const mom = (c[i] ?? past) / past - 1;
        if (trendUp && mom > 0) out[i] = 1;
        else if (!trendUp && mom < 0 && allowShort) out[i] = -1;
        else out[i] = 0;
      }
      return out;
    },
  },
];

export function getStrategy(id: string): StrategyDef | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function strategyMetaList() {
  return STRATEGIES.map(({ generateSignals: _g, ...meta }) => meta);
}
