// A. Smart Money Concepts & Price Action (10 strategies, IDs 1-10).
//
// All implementations are heuristic price-action approximations of the SMC
// concepts using only OHLCV data. Real SMC traders consider session context,
// orderflow tape, and market structure shifts that are subjective; here we
// formalise the rules into deterministic algorithms.
import type { Candle, Signal, StrategyDef } from "../../types/strategy";
import { rsi as rsiFn, sma as smaFn } from "../indicators";

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

// Detect 3-bar pivots (i is a high if it's higher than the lb bars on each side).
function findPivots(arr: Float64Array, lb: number, kind: "high" | "low"): number[] {
  const idx: number[] = [];
  for (let i = lb; i < arr.length - lb; i++) {
    let isPivot = true;
    for (let k = 1; k <= lb; k++) {
      if (kind === "high") {
        if (arr[i]! <= arr[i - k]! || arr[i]! <= arr[i + k]!) {
          isPivot = false;
          break;
        }
      } else {
        if (arr[i]! >= arr[i - k]! || arr[i]! >= arr[i + k]!) {
          isPivot = false;
          break;
        }
      }
    }
    if (isPivot) idx.push(i);
  }
  return idx;
}

export const SMC_STRATEGIES: StrategyDef[] = [
  // 1. Equal Highs/Lows Sweep
  {
    id: "smc_eq_sweep",
    name: "Equal Highs/Lows Sweep",
    tagline: "Trade the reversal after liquidity-grab wicks.",
    description:
      "Detects two pivot highs (or lows) within X% of each other (resting liquidity). Triggers a short when a wick sweeps above the equal highs but the candle closes back below them. Inverse for longs.",
    category: "smc",
    risk: "high",
    params: [
      { key: "pivotLb", label: "Pivot Lookback", type: "number", default: 5, min: 3, max: 15, step: 1 },
      { key: "tolerancePct", label: "Equal Tolerance %", type: "number", default: 0.2, min: 0.05, max: 1, step: 0.05 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const lb = Math.round(params.pivotLb ?? 5);
      const tol = (params.tolerancePct ?? 0.2) / 100;
      const pivotsHi = findPivots(h, lb, "high");
      const pivotsLo = findPivots(l, lb, "low");
      // Build a quick-lookup map: index -> last "equal level" price still active
      const eqHi = new Map<number, number>();
      const eqLo = new Map<number, number>();
      for (let p = 1; p < pivotsHi.length; p++) {
        const a = pivotsHi[p - 1]!;
        const b = pivotsHi[p]!;
        if (Math.abs(h[a]! - h[b]!) / h[b]! < tol) eqHi.set(b, Math.max(h[a]!, h[b]!));
      }
      for (let p = 1; p < pivotsLo.length; p++) {
        const a = pivotsLo[p - 1]!;
        const b = pivotsLo[p]!;
        if (Math.abs(l[a]! - l[b]!) / l[b]! < tol) eqLo.set(b, Math.min(l[a]!, l[b]!));
      }
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let armedHi = 0;
      let armedLo = 0;
      for (let i = 0; i < candles.length; i++) {
        if (eqHi.has(i)) armedHi = eqHi.get(i)!;
        if (eqLo.has(i)) armedLo = eqLo.get(i)!;
        if (armedHi > 0 && h[i]! > armedHi && c[i]! < armedHi) {
          pos = -1;
          armedHi = 0;
        } else if (armedLo > 0 && l[i]! < armedLo && c[i]! > armedLo) {
          pos = 1;
          armedLo = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 2. Order Block (OB) mitigation
  {
    id: "smc_order_block",
    name: "Order Block Mitigation",
    tagline: "Re-test of last opposite candle before BOS.",
    description:
      "When price breaks a recent swing high (BOS up), find the last bearish candle before the break — that's the bullish order block. Long entry when price retraces back into the order block range. Inverse for shorts.",
    category: "smc",
    risk: "high",
    params: [{ key: "pivotLb", label: "Pivot Lookback", type: "number", default: 5, min: 3, max: 15, step: 1 }],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const o = opens(candles);
      const lb = Math.round(params.pivotLb ?? 5);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let bullOB: { hi: number; lo: number; armed: boolean } | null = null;
      let bearOB: { hi: number; lo: number; armed: boolean } | null = null;
      for (let i = lb + 1; i < candles.length; i++) {
        let recentHi = -Infinity;
        let recentLo = Infinity;
        for (let k = i - lb; k < i; k++) {
          if (h[k]! > recentHi) recentHi = h[k]!;
          if (l[k]! < recentLo) recentLo = l[k]!;
        }
        // BOS up: c[i] > recent high — locate last bearish candle in lookback
        if (c[i]! > recentHi) {
          for (let k = i - 1; k >= Math.max(0, i - lb * 4); k--) {
            if (c[k]! < o[k]!) {
              bullOB = { hi: h[k]!, lo: l[k]!, armed: true };
              break;
            }
          }
        }
        if (c[i]! < recentLo) {
          for (let k = i - 1; k >= Math.max(0, i - lb * 4); k--) {
            if (c[k]! > o[k]!) {
              bearOB = { hi: h[k]!, lo: l[k]!, armed: true };
              break;
            }
          }
        }
        if (bullOB?.armed && l[i]! <= bullOB.hi && c[i]! >= bullOB.lo) {
          pos = 1;
          bullOB.armed = false;
        }
        if (bearOB?.armed && h[i]! >= bearOB.lo && c[i]! <= bearOB.hi) {
          pos = -1;
          bearOB.armed = false;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 3. Fair Value Gap (FVG) Fill
  {
    id: "smc_fvg_fill",
    name: "FVG 50% Fill",
    tagline: "Enter at 50% of an unfilled fair value gap.",
    description:
      "Detects a 3-candle imbalance (bullish FVG: low[i] > high[i-2]; bearish: high[i] < low[i-2]). Enters when price retraces to 50% of the gap, in the direction of the gap.",
    category: "smc",
    risk: "high",
    params: [],
    generateSignals(candles) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      const bullFVGs: { lo: number; hi: number; mid: number; armed: boolean }[] = [];
      const bearFVGs: { lo: number; hi: number; mid: number; armed: boolean }[] = [];
      for (let i = 2; i < candles.length; i++) {
        if (l[i]! > h[i - 2]!) {
          const lo = h[i - 2]!;
          const hi = l[i]!;
          bullFVGs.push({ lo, hi, mid: (lo + hi) / 2, armed: true });
          if (bullFVGs.length > 8) bullFVGs.shift();
        }
        if (h[i]! < l[i - 2]!) {
          const lo = h[i]!;
          const hi = l[i - 2]!;
          bearFVGs.push({ lo, hi, mid: (lo + hi) / 2, armed: true });
          if (bearFVGs.length > 8) bearFVGs.shift();
        }
        for (const g of bullFVGs) {
          if (g.armed && l[i]! <= g.mid && c[i]! >= g.mid) {
            pos = 1;
            g.armed = false;
          }
        }
        for (const g of bearFVGs) {
          if (g.armed && h[i]! >= g.mid && c[i]! <= g.mid) {
            pos = -1;
            g.armed = false;
          }
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 4. BOS continuation
  {
    id: "smc_bos_continuation",
    name: "BOS Continuation",
    tagline: "Trade pullback after structure break.",
    description:
      "After a Break of Structure (close above last pivot high) confirmed by above-average volume, enter long on the first pullback to the broken level. Inverse for shorts.",
    category: "smc",
    risk: "medium",
    params: [
      { key: "pivotLb", label: "Pivot Lookback", type: "number", default: 7, min: 3, max: 20, step: 1 },
      { key: "volMult", label: "Vol × Avg", type: "number", default: 1.2, min: 1, max: 3, step: 0.1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const v = vols(candles);
      const lb = Math.round(params.pivotLb ?? 7);
      const volMult = params.volMult ?? 1.2;
      const avgV = smaFn(v, 20);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let bosUpLevel = 0;
      let bosDnLevel = 0;
      for (let i = lb; i < candles.length; i++) {
        let pivotHi = -Infinity;
        let pivotLo = Infinity;
        for (let k = i - lb; k < i; k++) {
          if (h[k]! > pivotHi) pivotHi = h[k]!;
          if (l[k]! < pivotLo) pivotLo = l[k]!;
        }
        const volOK = v[i]! > avgV[i]! * volMult;
        if (c[i]! > pivotHi && volOK) bosUpLevel = pivotHi;
        if (c[i]! < pivotLo && volOK) bosDnLevel = pivotLo;
        if (bosUpLevel > 0 && l[i]! <= bosUpLevel && c[i]! > bosUpLevel) {
          pos = 1;
          bosUpLevel = 0;
        }
        if (bosDnLevel > 0 && h[i]! >= bosDnLevel && c[i]! < bosDnLevel) {
          pos = -1;
          bosDnLevel = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 5. CHOCH (Change of Character) reversal with RSI divergence
  {
    id: "smc_choch_reversal",
    name: "CHOCH Reversal",
    tagline: "Structure flip + RSI divergence = reversal.",
    description:
      "Bull-to-bear CHOCH = previous higher-low broken by lower-low. We confirm with bearish RSI divergence (price LL, RSI HL) and short. Mirror for bullish CHOCH.",
    category: "smc",
    risk: "extreme",
    params: [
      { key: "pivotLb", label: "Pivot Lookback", type: "number", default: 5, min: 3, max: 15, step: 1 },
      { key: "rsiPeriod", label: "RSI Period", type: "number", default: 14, min: 5, max: 30, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const lb = Math.round(params.pivotLb ?? 5);
      const r = rsiFn(c, Math.round(params.rsiPeriod ?? 14));
      const pivotsHi = findPivots(h, lb, "high");
      const pivotsLo = findPivots(l, lb, "low");
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = lb; i < candles.length; i++) {
        // last 2 swing lows
        const recentLos = pivotsLo.filter((p) => p < i).slice(-2);
        const recentHis = pivotsHi.filter((p) => p < i).slice(-2);
        if (recentLos.length === 2) {
          const a = recentLos[0]!;
          const b = recentLos[1]!;
          // CHOCH down: lower low + bearish divergence (h2 > h1 in price but RSI lower)
          if (l[b]! < l[a]! && c[i]! < l[b]!) {
            // bear CHOCH confirmed at this bar
            if (recentHis.length === 2) {
              const ha2 = recentHis[1]!;
              const ha1 = recentHis[0]!;
              if (h[ha2]! > h[ha1]! && r[ha2]! < r[ha1]!) {
                pos = -1;
              }
            }
          }
        }
        if (recentHis.length === 2) {
          const a = recentHis[0]!;
          const b = recentHis[1]!;
          if (h[b]! > h[a]! && c[i]! > h[b]!) {
            if (recentLos.length === 2) {
              const la2 = recentLos[1]!;
              const la1 = recentLos[0]!;
              if (l[la2]! < l[la1]! && r[la2]! > r[la1]!) {
                pos = 1;
              }
            }
          }
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 6. Premium & Discount Zone
  {
    id: "smc_premium_discount",
    name: "Premium / Discount Zone",
    tagline: "Long discount (<50%), short premium (>50%).",
    description:
      "Measures swing high to swing low (last N bars). Long permitted only when price is below the 50% midpoint (discount). Short only when above (premium). Trades on EMA crossover within the allowed zone.",
    category: "smc",
    risk: "medium",
    params: [
      { key: "lookback", label: "Range Lookback", type: "number", default: 50, min: 10, max: 200, step: 1 },
      { key: "emaFast", label: "EMA Fast", type: "number", default: 9, min: 3, max: 30, step: 1 },
      { key: "emaSlow", label: "EMA Slow", type: "number", default: 21, min: 8, max: 60, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const lb = Math.round(params.lookback ?? 50);
      const fast = Math.round(params.emaFast ?? 9);
      const slow = Math.round(params.emaSlow ?? 21);
      const ef = new Float64Array(c.length);
      const es = new Float64Array(c.length);
      // simple EMA
      const k1 = 2 / (fast + 1);
      const k2 = 2 / (slow + 1);
      ef[0] = c[0]!;
      es[0] = c[0]!;
      for (let i = 1; i < c.length; i++) {
        ef[i] = c[i]! * k1 + ef[i - 1]! * (1 - k1);
        es[i] = c[i]! * k2 + es[i - 1]! * (1 - k2);
      }
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = lb; i < candles.length; i++) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let k = i - lb; k < i; k++) {
          if (h[k]! > hi) hi = h[k]!;
          if (l[k]! < lo) lo = l[k]!;
        }
        const mid = (hi + lo) / 2;
        const inDiscount = c[i]! < mid;
        const inPremium = c[i]! > mid;
        const up = ef[i - 1]! <= es[i - 1]! && ef[i]! > es[i]!;
        const dn = ef[i - 1]! >= es[i - 1]! && ef[i]! < es[i]!;
        if (up && inDiscount) pos = 1;
        else if (dn && inPremium) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  // 7. Breaker Block
  {
    id: "smc_breaker_block",
    name: "Breaker Block",
    tagline: "Failed OB flips role; trade the retest.",
    description:
      "When a bullish order block (last bear candle before up-impulse) fails (price closes back below it), it becomes a bearish breaker. Short on retest of the breaker zone. Inverse for bullish breakers.",
    category: "smc",
    risk: "high",
    params: [{ key: "pivotLb", label: "Pivot Lookback", type: "number", default: 5, min: 3, max: 15, step: 1 }],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const o = opens(candles);
      const lb = Math.round(params.pivotLb ?? 5);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let bullOB: { hi: number; lo: number; broken: boolean; armed: boolean } | null = null;
      let bearOB: { hi: number; lo: number; broken: boolean; armed: boolean } | null = null;
      for (let i = lb + 1; i < candles.length; i++) {
        let pivotHi = -Infinity;
        let pivotLo = Infinity;
        for (let k = i - lb; k < i; k++) {
          if (h[k]! > pivotHi) pivotHi = h[k]!;
          if (l[k]! < pivotLo) pivotLo = l[k]!;
        }
        if (c[i]! > pivotHi) {
          for (let k = i - 1; k >= Math.max(0, i - lb * 4); k--) {
            if (c[k]! < o[k]!) {
              bullOB = { hi: h[k]!, lo: l[k]!, broken: false, armed: true };
              break;
            }
          }
        }
        if (c[i]! < pivotLo) {
          for (let k = i - 1; k >= Math.max(0, i - lb * 4); k--) {
            if (c[k]! > o[k]!) {
              bearOB = { hi: h[k]!, lo: l[k]!, broken: false, armed: true };
              break;
            }
          }
        }
        // breaker formation
        if (bullOB && !bullOB.broken && c[i]! < bullOB.lo) {
          bullOB.broken = true;
          bullOB.armed = true;
        }
        if (bearOB && !bearOB.broken && c[i]! > bearOB.hi) {
          bearOB.broken = true;
          bearOB.armed = true;
        }
        // retest entry
        if (bullOB?.broken && bullOB.armed && h[i]! >= bullOB.lo && c[i]! < bullOB.lo) {
          pos = -1;
          bullOB.armed = false;
        }
        if (bearOB?.broken && bearOB.armed && l[i]! <= bearOB.hi && c[i]! > bearOB.hi) {
          pos = 1;
          bearOB.armed = false;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 8. Mitigation Block
  {
    id: "smc_mitigation_block",
    name: "Mitigation Block",
    tagline: "Failed-HH origin candle becomes mitigation zone.",
    description:
      "Detects failure to make a higher high before a structure break. The candle that produced the failed high is a mitigation block — short on retest. Inverse for failed lower low.",
    category: "smc",
    risk: "high",
    params: [{ key: "pivotLb", label: "Pivot Lookback", type: "number", default: 5, min: 3, max: 15, step: 1 }],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const lb = Math.round(params.pivotLb ?? 5);
      const pivotsHi = findPivots(h, lb, "high");
      const pivotsLo = findPivots(l, lb, "low");
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let bearMB: { hi: number; lo: number; armed: boolean } | null = null;
      let bullMB: { hi: number; lo: number; armed: boolean } | null = null;
      for (let i = lb; i < candles.length; i++) {
        const recentHis = pivotsHi.filter((p) => p < i).slice(-2);
        const recentLos = pivotsLo.filter((p) => p < i).slice(-2);
        if (recentHis.length === 2) {
          const a = recentHis[0]!;
          const b = recentHis[1]!;
          if (h[b]! < h[a]! && l[i]! < l[b]!) {
            // failed HH and structure broke down
            bearMB = { hi: h[b]!, lo: c[b]!, armed: true };
          }
        }
        if (recentLos.length === 2) {
          const a = recentLos[0]!;
          const b = recentLos[1]!;
          if (l[b]! > l[a]! && h[i]! > h[b]!) {
            bullMB = { hi: c[b]!, lo: l[b]!, armed: true };
          }
        }
        if (bearMB?.armed && h[i]! >= bearMB.lo && c[i]! < bearMB.hi) {
          pos = -1;
          bearMB.armed = false;
        }
        if (bullMB?.armed && l[i]! <= bullMB.hi && c[i]! > bullMB.lo) {
          pos = 1;
          bullMB.armed = false;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 9. Asian Session Killzone
  {
    id: "smc_asian_killzone",
    name: "Asian Killzone Sweep",
    tagline: "Trade liquidity sweep of Asian range at London/NY open.",
    description:
      "Marks the high/low of the prior Asian session (first N bars of each cycle). When the next session sweeps either edge (wick beyond, close back inside), trade the reversal.",
    category: "smc",
    risk: "high",
    params: [
      { key: "asianBars", label: "Asian Bars", type: "number", default: 8, min: 2, max: 24, step: 1 },
      { key: "sessionBars", label: "Cycle Bars", type: "number", default: 24, min: 8, max: 288, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const asian = Math.round(params.asianBars ?? 8);
      const cycle = Math.round(params.sessionBars ?? 24);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let asianHi = -Infinity;
      let asianLo = Infinity;
      let active = false;
      for (let i = 0; i < candles.length; i++) {
        const idx = i % cycle;
        if (idx === 0) {
          asianHi = h[i]!;
          asianLo = l[i]!;
          active = false;
        } else if (idx < asian) {
          if (h[i]! > asianHi) asianHi = h[i]!;
          if (l[i]! < asianLo) asianLo = l[i]!;
        } else {
          if (!active) active = true;
          if (h[i]! > asianHi && c[i]! < asianHi) pos = -1;
          else if (l[i]! < asianLo && c[i]! > asianLo) pos = 1;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 10. Inducement Trap
  {
    id: "smc_inducement",
    name: "Inducement Trap",
    tagline: "Wait for minor liquidity grab at extremes.",
    description:
      "Identifies a minor pivot (the inducement) within a deeper trend. When price spikes past the inducement and reverses sharply, enter at the extreme POI in the trend direction.",
    category: "smc",
    risk: "extreme",
    params: [
      { key: "minorLb", label: "Minor Lookback", type: "number", default: 3, min: 2, max: 8, step: 1 },
      { key: "majorLb", label: "Major Lookback", type: "number", default: 15, min: 8, max: 50, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const o = opens(candles);
      const minor = Math.round(params.minorLb ?? 3);
      const major = Math.round(params.majorLb ?? 15);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = major; i < candles.length; i++) {
        let majHi = -Infinity;
        let majLo = Infinity;
        for (let k = i - major; k < i; k++) {
          if (h[k]! > majHi) majHi = h[k]!;
          if (l[k]! < majLo) majLo = l[k]!;
        }
        let minHi = -Infinity;
        let minLo = Infinity;
        for (let k = i - minor; k < i; k++) {
          if (h[k]! > minHi) minHi = h[k]!;
          if (l[k]! < minLo) minLo = l[k]!;
        }
        // Inducement at top: minor high taken out, but well below major high → short
        if (h[i]! > minHi && c[i]! < o[i]! && c[i]! < minHi && majHi > minHi * 1.005) {
          pos = -1;
        } else if (l[i]! < minLo && c[i]! > o[i]! && c[i]! > minLo && majLo < minLo * 0.995) {
          pos = 1;
        }
        out[i] = pos;
      }
      return out;
    },
  },
];
