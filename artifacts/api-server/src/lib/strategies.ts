import type { Candle, Signal, StrategyDef } from "../types/strategy";

export function ema(values: Float64Array, period: number): Float64Array {
  const out = new Float64Array(values.length);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = values[0]!;
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: Float64Array, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  out.fill(50);
  if (n < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = period + 1; i < n; i++) {
    const diff = values[i]! - values[i - 1]!;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export function atr(
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
  period: number,
): Float64Array {
  const n = highs.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const tr = new Float64Array(n);
  tr[0] = highs[0]! - lows[0]!;
  for (let i = 1; i < n; i++) {
    const h = highs[i]!;
    const l = lows[i]!;
    const pc = closes[i - 1]!;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  // Wilder smoothing
  let acc = 0;
  for (let i = 0; i < period && i < n; i++) acc += tr[i]!;
  out[period - 1] = acc / period;
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1]! * (period - 1) + tr[i]!) / period;
  }
  return out;
}

function closes(candles: Candle[]): Float64Array {
  const out = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = candles[i]!.c;
  return out;
}

function highs(candles: Candle[]): Float64Array {
  const out = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = candles[i]!.h;
  return out;
}

function lows(candles: Candle[]): Float64Array {
  const out = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = candles[i]!.l;
  return out;
}

export const STRATEGIES: StrategyDef[] = [
  {
    id: "momentum_trend_cross",
    name: "Momentum Trend Crossover",
    tagline: "EMA crossover gated by RSI momentum filter.",
    description:
      "Long when fast EMA crosses above slow EMA AND RSI(14) > threshold (momentum confirms uptrend). Short when fast EMA crosses below slow EMA AND RSI(14) < (100 - threshold). Pairs with ATR-based stops and an R:R take-profit.",
    category: "trend",
    risk: "high",
    params: [
      { key: "emaFast", label: "EMA Fast", type: "number", default: 20, min: 5, max: 100, step: 1 },
      { key: "emaSlow", label: "EMA Slow", type: "number", default: 50, min: 20, max: 400, step: 1 },
      { key: "rsiPeriod", label: "RSI Period", type: "number", default: 14, min: 5, max: 50, step: 1 },
      {
        key: "rsiThreshold",
        label: "RSI Threshold",
        type: "number",
        default: 50,
        min: 30,
        max: 70,
        step: 1,
        description: "Long requires RSI > threshold; short requires RSI < (100 - threshold)",
      },
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
      const fastP = Math.max(2, Math.round(params.emaFast ?? 20));
      const slowP = Math.max(fastP + 1, Math.round(params.emaSlow ?? 50));
      const rsiP = Math.max(3, Math.round(params.rsiPeriod ?? 14));
      const thr = params.rsiThreshold ?? 50;
      const allowShort = (params.allowShort ?? 1) > 0.5;
      const fast = ema(c, fastP);
      const slow = ema(c, slowP);
      const r = rsi(c, rsiP);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 1; i < candles.length; i++) {
        const fPrev = fast[i - 1]!;
        const sPrev = slow[i - 1]!;
        const f = fast[i]!;
        const s = slow[i]!;
        const rsiNow = r[i]!;
        const crossUp = fPrev <= sPrev && f > s;
        const crossDn = fPrev >= sPrev && f < s;
        if (crossUp && rsiNow > thr) pos = 1;
        else if (crossDn && rsiNow < 100 - thr && allowShort) pos = -1;
        else if (crossUp || crossDn) pos = 0;
        out[i] = pos;
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

export { closes as closesArr, highs as highsArr, lows as lowsArr };
