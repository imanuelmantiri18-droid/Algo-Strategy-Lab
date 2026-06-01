// D. Volatility & Breakout (10 strategies, IDs 31-40).
import type { Candle, Signal, StrategyDef } from "../../types/strategy";
import {
  bollinger,
  donchian,
  ema,
  keltner,
  sma,
  stddevRolling,
  atr as atrFn,
} from "../indicators";

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

export const BREAKOUT_STRATEGIES: StrategyDef[] = [
  // 31. ATR breakout
  {
    id: "atr_breakout",
    name: "ATR Range Breakout",
    tagline: "Bar closes outside open ± Nx ATR.",
    description:
      "Long when close > open + (ATR × multiplier); short when close < open - (ATR × multiplier). Captures expansion bars after consolidation.",
    category: "breakout",
    risk: "high",
    params: [
      { key: "atrPeriod", label: "ATR Period", type: "number", default: 14, min: 5, max: 30, step: 1 },
      { key: "mult", label: "ATR Mult", type: "number", default: 2, min: 0.5, max: 5, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const o = opens(candles);
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const a = atrFn(h, l, c, Math.round(params.atrPeriod ?? 14));
      const mult = params.mult ?? 2;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 0; i < candles.length; i++) {
        if (c[i]! > o[i]! + mult * a[i]!) pos = 1;
        else if (c[i]! < o[i]! - mult * a[i]!) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  // 32. Inside Bar breakout
  {
    id: "inside_bar_break",
    name: "Inside Bar Breakout",
    tagline: "Break above/below the mother bar of an inside bar.",
    description:
      "When current bar is fully inside the previous bar's range (inside bar), watch the mother bar. Long when next bar's high breaks above mother high; short when next low breaks below mother low.",
    category: "breakout",
    risk: "medium",
    params: [],
    generateSignals(candles) {
      const h = highs(candles);
      const l = lows(candles);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let motherHi = 0;
      let motherLo = 0;
      let armed = false;
      for (let i = 1; i < candles.length; i++) {
        const isInside = h[i]! < h[i - 1]! && l[i]! > l[i - 1]!;
        if (isInside) {
          motherHi = h[i - 1]!;
          motherLo = l[i - 1]!;
          armed = true;
        } else if (armed) {
          if (h[i]! > motherHi) {
            pos = 1;
            armed = false;
          } else if (l[i]! < motherLo) {
            pos = -1;
            armed = false;
          }
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 33. Opening Range Breakout
  {
    id: "opening_range_break",
    name: "Opening Range Breakout",
    tagline: "Mark first N bars of session, trade the breakout.",
    description:
      "Builds a range from the first N bars of each session (default 4 bars = 4h on 1h). Long if a later bar closes above the range high; short if below the low. Resets every session.",
    category: "breakout",
    risk: "high",
    params: [
      { key: "rangeBars", label: "Range Bars", type: "number", default: 4, min: 1, max: 24, step: 1 },
      { key: "sessionBars", label: "Session Bars", type: "number", default: 24, min: 4, max: 288, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const rb = Math.round(params.rangeBars ?? 4);
      const sess = Math.round(params.sessionBars ?? 24);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let rangeHi = -Infinity;
      let rangeLo = Infinity;
      for (let i = 0; i < candles.length; i++) {
        const sessIdx = i % sess;
        if (sessIdx === 0) {
          rangeHi = h[i]!;
          rangeLo = l[i]!;
          pos = 0;
        } else if (sessIdx < rb) {
          if (h[i]! > rangeHi) rangeHi = h[i]!;
          if (l[i]! < rangeLo) rangeLo = l[i]!;
        } else {
          if (c[i]! > rangeHi) pos = 1;
          else if (c[i]! < rangeLo) pos = -1;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 34. TTM Squeeze
  {
    id: "ttm_squeeze",
    name: "TTM Squeeze",
    tagline: "BB inside KC = squeeze; release with momentum.",
    description:
      "Squeeze: Bollinger Bands compress inside Keltner Channels (low volatility). Fire long when bands expand back outside KC AND price > middle EMA. Fire short on inverse.",
    category: "breakout",
    risk: "high",
    params: [
      { key: "period", label: "Period", type: "number", default: 20, min: 10, max: 50, step: 1 },
      { key: "bbMult", label: "BB Std", type: "number", default: 2, min: 1, max: 3, step: 0.25 },
      { key: "kcMult", label: "KC ATR Mult", type: "number", default: 1.5, min: 1, max: 3, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const p = Math.round(params.period ?? 20);
      const bb = bollinger(c, p, params.bbMult ?? 2);
      const a = atrFn(h, l, c, p);
      const k = keltner(c, a, p, params.kcMult ?? 1.5);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let inSqueeze = false;
      for (let i = p; i < candles.length; i++) {
        const isSqueeze = bb.upper[i]! < k.upper[i]! && bb.lower[i]! > k.lower[i]!;
        if (isSqueeze) inSqueeze = true;
        else if (inSqueeze) {
          // squeeze just released
          if (c[i]! > bb.mid[i]!) pos = 1;
          else if (c[i]! < bb.mid[i]!) pos = -1;
          inSqueeze = false;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 35. Historical Volatility spike
  {
    id: "hv_spike",
    name: "Historical Volatility Spike",
    tagline: "Activate trend-following only when HV explodes.",
    description:
      "Idle when realized volatility (rolling stddev of returns) is below its long-period average. When HV spikes above 1.5× its average, follow the EMA trend.",
    category: "breakout",
    risk: "high",
    params: [
      { key: "shortPeriod", label: "Short HV", type: "number", default: 10, min: 5, max: 30, step: 1 },
      { key: "longPeriod", label: "Long HV", type: "number", default: 50, min: 20, max: 200, step: 1 },
      { key: "spike", label: "Spike Mult", type: "number", default: 1.5, min: 1, max: 4, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const ret = new Float64Array(c.length);
      for (let i = 1; i < c.length; i++) ret[i] = (c[i]! - c[i - 1]!) / c[i - 1]!;
      const hvShort = stddevRolling(ret, Math.round(params.shortPeriod ?? 10));
      const hvLong = stddevRolling(ret, Math.round(params.longPeriod ?? 50));
      const trend = ema(c, 50);
      const spike = params.spike ?? 1.5;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 0; i < candles.length; i++) {
        if (hvShort[i]! > hvLong[i]! * spike) {
          pos = c[i]! > trend[i]! ? 1 : -1;
        } else {
          pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 36. Fractal breakout (Williams)
  {
    id: "fractal_breakout",
    name: "Williams Fractal Breakout",
    tagline: "Break the most recent 5-bar fractal.",
    description:
      "Identifies 5-bar fractals (high higher than 2 left+2 right; symmetric for lows). Long when price breaks above last up-fractal; short when breaks below last down-fractal.",
    category: "breakout",
    risk: "medium",
    params: [],
    generateSignals(candles) {
      const h = highs(candles);
      const l = lows(candles);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let lastUp = Infinity;
      let lastDn = -Infinity;
      for (let i = 2; i < candles.length; i++) {
        // Fractal detection requires 2 confirmed bars to the right.
        // Only run it when those bars exist to avoid out-of-bounds reads.
        if (i < candles.length - 2) {
          const isUp = h[i]! > h[i - 1]! && h[i]! > h[i - 2]! && h[i]! > h[i + 1]! && h[i]! > h[i + 2]!;
          const isDn = l[i]! < l[i - 1]! && l[i]! < l[i - 2]! && l[i]! < l[i + 1]! && l[i]! < l[i + 2]!;
          if (isUp) lastUp = h[i]!;
          if (isDn) lastDn = l[i]!;
        }
        // Breakout check runs on every bar including the last 2 — the live bot
        // reads signals[signals.length - 1] so this must always reflect the
        // current position rather than being stuck at the initial 0.
        if (h[i]! > lastUp && lastUp !== Infinity) {
          pos = 1;
          lastUp = Infinity;
        } else if (l[i]! < lastDn && lastDn !== -Infinity) {
          pos = -1;
          lastDn = -Infinity;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 37. Darvas Box (simplified Donchian-style)
  {
    id: "darvas_box",
    name: "Darvas Box",
    tagline: "Establish a box on new high; trade the breakout.",
    description:
      "After a new N-bar high, watch a box defined by that high and the lowest low since. Long when price closes above the box top after the box is 'set'.",
    category: "breakout",
    risk: "medium",
    params: [
      { key: "lookback", label: "Lookback Bars", type: "number", default: 50, min: 20, max: 200, step: 1 },
      { key: "settleBars", label: "Settle Bars", type: "number", default: 5, min: 2, max: 20, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const lb = Math.round(params.lookback ?? 50);
      const settle = Math.round(params.settleBars ?? 5);
      const d = donchian(h, l, lb);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let boxTop = 0;
      let boxBot = 0;
      let setBars = 0;
      for (let i = lb; i < candles.length; i++) {
        if (h[i]! >= d.upper[i]! - 1e-9) {
          boxTop = h[i]!;
          boxBot = l[i]!;
          setBars = 0;
        } else if (boxTop > 0) {
          if (l[i]! < boxBot) boxBot = l[i]!;
          setBars++;
          if (setBars >= settle) {
            if (c[i]! > boxTop) pos = 1;
            else if (c[i]! < boxBot) pos = -1;
          }
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 38. Pivot Point breakout
  {
    id: "pivot_breakout",
    name: "Pivot Point Breakout",
    tagline: "Break R1 with volume = long; break S1 = short.",
    description:
      "Computes daily floor pivots from the previous session (PP, R1, S1). Long when price breaks above R1 with volume > 1.5× avg; short below S1.",
    category: "breakout",
    risk: "high",
    params: [
      { key: "sessionBars", label: "Session Bars", type: "number", default: 24, min: 1, max: 288, step: 1 },
      { key: "volMult", label: "Vol × Avg", type: "number", default: 1.5, min: 1, max: 4, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const v = vols(candles);
      const sess = Math.round(params.sessionBars ?? 24);
      const volMult = params.volMult ?? 1.5;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let pp = 0;
      let r1 = 0;
      let s1 = 0;
      let prevHi = -Infinity;
      let prevLo = Infinity;
      let prevClose = 0;
      let curHi = -Infinity;
      let curLo = Infinity;
      for (let i = 0; i < candles.length; i++) {
        const sessIdx = i % sess;
        if (sessIdx === 0 && i > 0) {
          prevHi = curHi;
          prevLo = curLo;
          prevClose = c[i - 1]!;
          pp = (prevHi + prevLo + prevClose) / 3;
          r1 = 2 * pp - prevLo;
          s1 = 2 * pp - prevHi;
          curHi = h[i]!;
          curLo = l[i]!;
        } else {
          if (h[i]! > curHi) curHi = h[i]!;
          if (l[i]! < curLo) curLo = l[i]!;
        }
        if (pp > 0) {
          const start = Math.max(0, i - 20);
          let avgV = 0;
          for (let k = start; k <= i; k++) avgV += v[k]!;
          avgV /= i - start + 1;
          const volOK = avgV > 0 && v[i]! > avgV * volMult;
          if (volOK && c[i]! > r1) pos = 1;
          else if (volOK && c[i]! < s1) pos = -1;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 39. Chandelier Exit (Volatility Stop)
  {
    id: "chandelier_exit",
    name: "Chandelier Exit",
    tagline: "Trend by ATR-trailed extremes.",
    description:
      "Long when price > recent high - (ATR × mult); short when price < recent low + (ATR × mult). The trail acts as both signal and stop.",
    category: "breakout",
    risk: "medium",
    params: [
      { key: "atrPeriod", label: "ATR Period", type: "number", default: 22, min: 7, max: 50, step: 1 },
      { key: "lookback", label: "HHV/LLV Lookback", type: "number", default: 22, min: 7, max: 50, step: 1 },
      { key: "mult", label: "ATR Mult", type: "number", default: 3, min: 1, max: 6, step: 0.5 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const a = atrFn(h, l, c, Math.round(params.atrPeriod ?? 22));
      const lb = Math.round(params.lookback ?? 22);
      const mult = params.mult ?? 3;
      const d = donchian(h, l, lb);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 1;
      for (let i = 0; i < candles.length; i++) {
        const longTrail = d.upper[i]! - mult * a[i]!;
        const shortTrail = d.lower[i]! + mult * a[i]!;
        if (pos === 1 && c[i]! < longTrail) pos = -1;
        else if (pos === -1 && c[i]! > shortTrail) pos = 1;
        out[i] = pos;
      }
      return out;
    },
  },
  // 40. Volume-weighted breakout
  {
    id: "volume_weighted_break",
    name: "Volume-Weighted Breakout",
    tagline: "Donchian break confirmed by 2× volume surge.",
    description:
      "Long when price breaks above a Donchian-50 high AND volume > 2× the 50-bar average. Short on inverse.",
    category: "breakout",
    risk: "medium",
    params: [
      { key: "lookback", label: "Donchian Period", type: "number", default: 50, min: 10, max: 200, step: 1 },
      { key: "volMult", label: "Vol × Avg", type: "number", default: 2, min: 1, max: 5, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const v = vols(candles);
      const lb = Math.round(params.lookback ?? 50);
      const volMult = params.volMult ?? 2;
      const d = donchian(h, l, lb);
      const avg = sma(v, lb);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = lb; i < candles.length; i++) {
        const volOK = avg[i]! > 0 && v[i]! >= avg[i]! * volMult;
        if (c[i]! >= d.upper[i - 1]! && volOK) pos = 1;
        else if (c[i]! <= d.lower[i - 1]! && volOK) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
];
