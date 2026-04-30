// E. Order Flow, Volume & Market Making (5 strategies, IDs 41-45).
// Most of these require L2 order book or funding-rate streams that
// data-api.binance.vision (OHLCV only) does not provide. Where possible we
// implement a candle-based proxy (e.g. CVD via close-vs-open volume signing).
// Strategies marked `available: false` are tournament-skipped.
import type { Candle, Signal, StrategyDef } from "../../types/strategy";
import { sma as smaFn } from "../indicators";

const closes = (cs: Candle[]) => {
  const out = new Float64Array(cs.length);
  for (let i = 0; i < cs.length; i++) out[i] = cs[i]!.c;
  return out;
};
const opens = (cs: Candle[]) => {
  const out = new Float64Array(cs.length);
  for (let i = 0; i < cs.length; i++) out[i] = cs[i]!.o;
  return out;
};
const highs = (cs: Candle[]) => {
  const out = new Float64Array(cs.length);
  for (let i = 0; i < cs.length; i++) out[i] = cs[i]!.h;
  return out;
};
const lows = (cs: Candle[]) => {
  const out = new Float64Array(cs.length);
  for (let i = 0; i < cs.length; i++) out[i] = cs[i]!.l;
  return out;
};
const vols = (cs: Candle[]) => {
  const out = new Float64Array(cs.length);
  for (let i = 0; i < cs.length; i++) out[i] = cs[i]!.v;
  return out;
};

export const ORDERFLOW_STRATEGIES: StrategyDef[] = [
  // 41. CVD Divergence (proxy via close-vs-open volume signing)
  {
    id: "of_cvd_divergence",
    name: "CVD Divergence (proxy)",
    tagline: "Heuristic delta from candle direction × volume.",
    description:
      "True CVD requires aggressor-side trade data. We approximate it: bullish bars contribute +volume, bearish bars contribute -volume. Then take the cumulative delta and look for divergence vs price (price LL but CVD HL → long; mirror for short).",
    category: "orderflow",
    risk: "extreme",
    available: true,
    params: [
      { key: "lookback", label: "Pivot Lookback", type: "number", default: 10, min: 5, max: 30, step: 1 },
    ],
    generateSignals(candles, params) {
      const o = opens(candles);
      const c = closes(candles);
      const h = highs(candles);
      const l = lows(candles);
      const v = vols(candles);
      const lb = Math.round(params.lookback ?? 10);
      const cvd = new Float64Array(candles.length);
      let acc = 0;
      for (let i = 0; i < candles.length; i++) {
        const sign = c[i]! > o[i]! ? 1 : c[i]! < o[i]! ? -1 : 0;
        acc += sign * v[i]!;
        cvd[i] = acc;
      }
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let lastLowIdx = -1;
      let lastHighIdx = -1;
      for (let i = lb; i < candles.length - lb; i++) {
        let isLow = true;
        let isHigh = true;
        for (let k = 1; k <= lb; k++) {
          if (l[i]! >= l[i - k]! || l[i]! >= l[i + k]!) isLow = false;
          if (h[i]! <= h[i - k]! || h[i]! <= h[i + k]!) isHigh = false;
        }
        if (isLow) {
          if (lastLowIdx >= 0 && l[i]! < l[lastLowIdx]! && cvd[i]! > cvd[lastLowIdx]!) {
            pos = 1;
          }
          lastLowIdx = i;
        }
        if (isHigh) {
          if (lastHighIdx >= 0 && h[i]! > h[lastHighIdx]! && cvd[i]! < cvd[lastHighIdx]!) {
            pos = -1;
          }
          lastHighIdx = i;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 42. Order Book Imbalance — UNAVAILABLE (no L2 data)
  {
    id: "of_orderbook_imbalance",
    name: "Order Book Imbalance",
    tagline: "Requires real-time L2 depth data (unavailable).",
    description:
      "Reads bid/ask depth and goes long when bid volume is 3× ask volume. The Binance public OHLCV feed does not include order book snapshots, so this strategy cannot run in the current data pipeline.",
    category: "orderflow",
    risk: "extreme",
    available: false,
    unavailableReason: "Requires real-time order book snapshots (L2 depth) — not provided by data-api.binance.vision.",
    params: [],
    generateSignals(candles) {
      return new Array(candles.length).fill(0);
    },
  },
  // 43. Funding Rate Arbitrage — UNAVAILABLE (no funding stream)
  {
    id: "of_funding_arb",
    name: "Funding Rate Arbitrage",
    tagline: "Requires perpetual funding stream + hedge venue (unavailable).",
    description:
      "Captures funding payments by holding hedged positions across exchanges. Needs a funding-rate API and a second venue for the hedge leg — neither is available in this lab.",
    category: "orderflow",
    risk: "low",
    available: false,
    unavailableReason: "Requires funding-rate API and a second venue for the hedge leg.",
    params: [],
    generateSignals(candles) {
      return new Array(candles.length).fill(0);
    },
  },
  // 44. Grid Trading (simulated as range-bound mean reversion via Bollinger)
  {
    id: "of_grid_maker",
    name: "Grid Maker (sideways)",
    tagline: "Single-position approximation of a grid maker.",
    description:
      "True grid trading places a ladder of limit orders. Our backtest engine is single-position, so we approximate: long every time price touches BB lower band, short every time it touches upper band, exit at midline. Wins when the market is sideways.",
    category: "orderflow",
    risk: "medium",
    available: true,
    params: [
      { key: "period", label: "Period", type: "number", default: 20, min: 10, max: 50, step: 1 },
      { key: "mult", label: "Std Dev Mult", type: "number", default: 1.5, min: 1, max: 3, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const p = Math.round(params.period ?? 20);
      const mult = params.mult ?? 1.5;
      const m = smaFn(c, p);
      // simple SD from indicator helper would be ideal — recompute inline
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = p; i < candles.length; i++) {
        let s = 0;
        for (let k = i - p + 1; k <= i; k++) {
          const d = c[k]! - m[i]!;
          s += d * d;
        }
        const sd = Math.sqrt(s / p);
        const upper = m[i]! + mult * sd;
        const lower = m[i]! - mult * sd;
        if (pos === 0) {
          if (c[i]! <= lower) pos = 1;
          else if (c[i]! >= upper) pos = -1;
        } else if ((pos === 1 && c[i]! >= m[i]!) || (pos === -1 && c[i]! <= m[i]!)) {
          pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 45. Volume Profile POC bounce (rolling)
  {
    id: "of_vp_poc_bounce",
    name: "Volume Profile POC Bounce",
    tagline: "POC = magnet price; long below, short above.",
    description:
      "Builds a histogram of volume at price over a rolling window (50 bars × 50 bins). The price level with the highest volume (POC) acts as a magnet. Long when price is below POC after divergence; short when above.",
    category: "orderflow",
    risk: "medium",
    available: true,
    params: [
      { key: "window", label: "Profile Window", type: "number", default: 100, min: 30, max: 300, step: 5 },
      { key: "bins", label: "Bins", type: "number", default: 50, min: 20, max: 100, step: 5 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const v = vols(candles);
      const win = Math.round(params.window ?? 100);
      const bins = Math.round(params.bins ?? 50);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = win; i < candles.length; i++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = i - win; k < i; k++) {
          if (c[k]! < lo) lo = c[k]!;
          if (c[k]! > hi) hi = c[k]!;
        }
        if (hi <= lo) continue;
        const binSize = (hi - lo) / bins;
        const buckets = new Float64Array(bins);
        for (let k = i - win; k < i; k++) {
          const b = Math.min(bins - 1, Math.max(0, Math.floor((c[k]! - lo) / binSize)));
          buckets[b]! += v[k]!;
        }
        let pocBin = 0;
        let maxV = 0;
        for (let b = 0; b < bins; b++) {
          if (buckets[b]! > maxV) {
            maxV = buckets[b]!;
            pocBin = b;
          }
        }
        const poc = lo + (pocBin + 0.5) * binSize;
        const distance = (c[i]! - poc) / poc;
        if (pos === 0) {
          if (distance < -0.01) pos = 1;
          else if (distance > 0.01) pos = -1;
        } else if ((pos === 1 && c[i]! >= poc) || (pos === -1 && c[i]! <= poc)) {
          pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
];
