// C. Mean Reversion (10 strategies, IDs 21-30).
import type { Candle, Signal, StrategyDef } from "../../types/strategy";
import {
  bollinger,
  cci,
  keltner,
  linRegSlope,
  rsi,
  sma,
  stochastic,
  williamsR,
  vwap,
  zscore,
  atr as atrFn,
} from "../indicators";

const closes = (cs: Candle[]) => {
  const out = new Float64Array(cs.length);
  for (let i = 0; i < cs.length; i++) out[i] = cs[i]!.c;
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

export const MEANREV_STRATEGIES: StrategyDef[] = [
  // 21. Bollinger Bands fade
  {
    id: "bbands_fade",
    name: "Bollinger Bands Fade",
    tagline: "Short upper band, long lower band; exit at midline.",
    description:
      "Long when price closes below the lower Bollinger Band. Short when price closes above the upper band. Exit when price returns to the middle SMA.",
    category: "mean_reversion",
    risk: "high",
    params: [
      { key: "period", label: "BB Period", type: "number", default: 20, min: 10, max: 50, step: 1 },
      { key: "mult", label: "BB Std Dev", type: "number", default: 2, min: 1, max: 4, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const bb = bollinger(c, Math.round(params.period ?? 20), params.mult ?? 2);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 0; i < candles.length; i++) {
        if (pos === 0) {
          if (c[i]! <= bb.lower[i]!) pos = 1;
          else if (c[i]! >= bb.upper[i]!) pos = -1;
        } else if ((pos === 1 && c[i]! >= bb.mid[i]!) || (pos === -1 && c[i]! <= bb.mid[i]!)) {
          pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 22. RSI extremes
  {
    id: "rsi_extremes",
    name: "RSI Extremes Reversal",
    tagline: "Bounce out of oversold/overbought zones.",
    description:
      "Long when RSI dips below 25 then crosses back above 30 (oversold bounce). Short when RSI rises above 75 then crosses back below 70.",
    category: "mean_reversion",
    risk: "medium",
    params: [
      { key: "period", label: "RSI Period", type: "number", default: 14, min: 5, max: 30, step: 1 },
      { key: "low", label: "Oversold", type: "number", default: 30, min: 10, max: 40, step: 1 },
      { key: "high", label: "Overbought", type: "number", default: 70, min: 60, max: 90, step: 1 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const r = rsi(c, Math.round(params.period ?? 14));
      const lo = params.low ?? 30;
      const hi = params.high ?? 70;
      const loEx = lo - 5;
      const hiEx = hi + 5;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let armedLong = false;
      let armedShort = false;
      for (let i = 1; i < candles.length; i++) {
        if (r[i]! <= loEx) armedLong = true;
        if (r[i]! >= hiEx) armedShort = true;
        if (armedLong && r[i - 1]! <= lo && r[i]! > lo) {
          pos = 1;
          armedLong = false;
        } else if (armedShort && r[i - 1]! >= hi && r[i]! < hi) {
          pos = -1;
          armedShort = false;
        } else if ((pos === 1 && r[i]! >= 50) || (pos === -1 && r[i]! <= 50)) {
          pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 23. Stochastic divergence (simplified: oversold + price lower-low while %K higher-low)
  {
    id: "stoch_divergence",
    name: "Stochastic Divergence",
    tagline: "Hidden div between price and Stochastic.",
    description:
      "Long when price prints a new local low BUT %K is higher than at the prior low (bullish divergence) AND %K is below 30. Inverse for shorts.",
    category: "mean_reversion",
    risk: "high",
    params: [
      { key: "kPeriod", label: "%K Period", type: "number", default: 14, min: 5, max: 30, step: 1 },
      { key: "dPeriod", label: "%D Period", type: "number", default: 3, min: 1, max: 10, step: 1 },
      { key: "lookback", label: "Pivot Lookback", type: "number", default: 5, min: 3, max: 15, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const st = stochastic(h, l, c, Math.round(params.kPeriod ?? 14), Math.round(params.dPeriod ?? 3));
      const lb = Math.round(params.lookback ?? 5);
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
          if (lastLowIdx >= 0 && l[i]! < l[lastLowIdx]! && st.k[i]! > st.k[lastLowIdx]! && st.k[i]! < 30) {
            pos = 1;
          }
          lastLowIdx = i;
        }
        if (isHigh) {
          if (lastHighIdx >= 0 && h[i]! > h[lastHighIdx]! && st.k[i]! < st.k[lastHighIdx]! && st.k[i]! > 70) {
            pos = -1;
          }
          lastHighIdx = i;
        }
        if ((pos === 1 && st.k[i]! > 50) || (pos === -1 && st.k[i]! < 50)) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },
  // 24. VWAP Pullback (session-based)
  {
    id: "vwap_pullback",
    name: "VWAP Pullback Fade",
    tagline: "Fade extreme deviations from session VWAP.",
    description:
      "Computes a session VWAP (resets every 24 hours of bars). Longs when price deviates -X% below VWAP and crosses back; shorts when +X% above and crosses back.",
    category: "mean_reversion",
    risk: "medium",
    params: [
      { key: "deviation", label: "Deviation %", type: "number", default: 1.5, min: 0.3, max: 5, step: 0.1 },
      { key: "sessionBars", label: "Session Bars", type: "number", default: 24, min: 1, max: 288, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const v = vols(candles);
      const sess = Math.round(params.sessionBars ?? 24);
      const dev = (params.deviation ?? 1.5) / 100;
      const vw = vwap(h, l, c, v, sess);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 1; i < candles.length; i++) {
        const offset = (c[i]! - vw[i]!) / vw[i]!;
        const offsetPrev = (c[i - 1]! - vw[i - 1]!) / vw[i - 1]!;
        if (pos === 0) {
          if (offsetPrev < -dev && offset > -dev) pos = 1;
          else if (offsetPrev > dev && offset < dev) pos = -1;
        } else if ((pos === 1 && c[i]! >= vw[i]!) || (pos === -1 && c[i]! <= vw[i]!)) {
          pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 25. Keltner Channel reversion
  {
    id: "keltner_reversion",
    name: "Keltner Channel Reversion",
    tagline: "Fade rejections at the Keltner outer bands.",
    description:
      "Long when low pierces the lower Keltner band but close finishes back inside. Short when high pierces upper but close finishes back inside.",
    category: "mean_reversion",
    risk: "medium",
    params: [
      { key: "emaPeriod", label: "EMA", type: "number", default: 20, min: 10, max: 50, step: 1 },
      { key: "atrPeriod", label: "ATR", type: "number", default: 14, min: 7, max: 30, step: 1 },
      { key: "mult", label: "ATR Mult", type: "number", default: 2, min: 1, max: 4, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const a = atrFn(h, l, c, Math.round(params.atrPeriod ?? 14));
      const k = keltner(c, a, Math.round(params.emaPeriod ?? 20), params.mult ?? 2);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 0; i < candles.length; i++) {
        if (pos === 0) {
          if (l[i]! < k.lower[i]! && c[i]! > k.lower[i]!) pos = 1;
          else if (h[i]! > k.upper[i]! && c[i]! < k.upper[i]!) pos = -1;
        } else if ((pos === 1 && c[i]! >= k.mid[i]!) || (pos === -1 && c[i]! <= k.mid[i]!)) {
          pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
  // 26. Williams %R extremes
  {
    id: "williams_r_extremes",
    name: "Williams %R Extremes",
    tagline: "Fast oversold/overbought via Williams %R.",
    description:
      "Long when %R(14) crosses above -80 (out of oversold). Short when %R crosses below -20 (out of overbought). Exit at -50.",
    category: "mean_reversion",
    risk: "high",
    params: [
      { key: "period", label: "Period", type: "number", default: 14, min: 5, max: 30, step: 1 },
      { key: "low", label: "Oversold", type: "number", default: -80, min: -95, max: -60, step: 1 },
      { key: "high", label: "Overbought", type: "number", default: -20, min: -40, max: -5, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const w = williamsR(h, l, c, Math.round(params.period ?? 14));
      const lo = params.low ?? -80;
      const hi = params.high ?? -20;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 1; i < candles.length; i++) {
        const up = w[i - 1]! <= lo && w[i]! > lo;
        const dn = w[i - 1]! >= hi && w[i]! < hi;
        if (up) pos = 1;
        else if (dn) pos = -1;
        else if ((pos === 1 && w[i]! >= -50) || (pos === -1 && w[i]! <= -50)) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },
  // 27. CCI zero-line reject
  {
    id: "cci_zero_reject",
    name: "CCI Zero-Line Reject",
    tagline: "Trade the rejection of the CCI zero line.",
    description:
      "Long when CCI(20) approaches 0 from below but reverses back down (failed crossover) — meaning the downtrend resumes. Inverse for shorts. Captures momentum continuation.",
    category: "mean_reversion",
    risk: "high",
    params: [{ key: "period", label: "CCI Period", type: "number", default: 20, min: 7, max: 50, step: 1 }],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const v = cci(h, l, c, Math.round(params.period ?? 20));
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 2; i < candles.length; i++) {
        // failed cross up (was negative, approached 0, then turned back)
        const failedUp = v[i - 2]! < -50 && v[i - 1]! > -25 && v[i]! < v[i - 1]! && v[i]! < 0;
        const failedDn = v[i - 2]! > 50 && v[i - 1]! < 25 && v[i]! > v[i - 1]! && v[i]! > 0;
        if (failedDn) pos = 1;
        else if (failedUp) pos = -1;
        else if ((pos === 1 && v[i]! > 100) || (pos === -1 && v[i]! < -100)) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },
  // 28. Z-Score mean reversion
  {
    id: "zscore_revert",
    name: "Z-Score Mean Reversion",
    tagline: "Long when Z < -threshold; short when Z > +threshold.",
    description:
      "Computes rolling Z-score of close. Long when Z < -2 (price 2 std below mean), short when Z > +2. Exit when Z crosses 0.",
    category: "mean_reversion",
    risk: "medium",
    params: [
      { key: "period", label: "Period", type: "number", default: 30, min: 10, max: 100, step: 1 },
      { key: "threshold", label: "Z Threshold", type: "number", default: 2, min: 1, max: 4, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const z = zscore(c, Math.round(params.period ?? 30));
      const thr = params.threshold ?? 2;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 0; i < candles.length; i++) {
        if (pos === 0) {
          if (z[i]! <= -thr) pos = 1;
          else if (z[i]! >= thr) pos = -1;
        } else if ((pos === 1 && z[i]! >= 0) || (pos === -1 && z[i]! <= 0)) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },
  // 29. MA Envelope bounce
  {
    id: "ma_envelope_bounce",
    name: "MA Envelope Bounce",
    tagline: "Bounce off ±X% envelope around SMA50.",
    description:
      "Long when price touches the lower envelope (SMA50 × (1 - X%)). Short at upper envelope. Exit at SMA50.",
    category: "mean_reversion",
    risk: "medium",
    params: [
      { key: "period", label: "SMA Period", type: "number", default: 50, min: 10, max: 200, step: 1 },
      { key: "envPct", label: "Envelope %", type: "number", default: 2, min: 0.5, max: 10, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const m = sma(c, Math.round(params.period ?? 50));
      const env = (params.envPct ?? 2) / 100;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 0; i < candles.length; i++) {
        const upper = m[i]! * (1 + env);
        const lower = m[i]! * (1 - env);
        if (pos === 0) {
          if (c[i]! <= lower) pos = 1;
          else if (c[i]! >= upper) pos = -1;
        } else if ((pos === 1 && c[i]! >= m[i]!) || (pos === -1 && c[i]! <= m[i]!)) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },
  // 30. Linear Regression Channel
  {
    id: "linreg_channel",
    name: "Linear Regression Channel",
    tagline: "Trade extremes around the linreg trendline.",
    description:
      "Computes rolling linear regression slope. When price > 2σ above the regression mean, short; when below by -2σ, long. Exit at the centerline.",
    category: "mean_reversion",
    risk: "medium",
    params: [
      { key: "period", label: "Period", type: "number", default: 50, min: 20, max: 200, step: 1 },
      { key: "mult", label: "σ Mult", type: "number", default: 2, min: 1, max: 4, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const p = Math.round(params.period ?? 50);
      const mult = params.mult ?? 2;
      const slope = linRegSlope(c, p);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = p; i < candles.length; i++) {
        let sumY = 0;
        for (let k = i - p + 1; k <= i; k++) sumY += c[k]!;
        const intercept = sumY / p - (slope[i]! * (p - 1)) / 2;
        const fit = intercept + slope[i]! * (p - 1);
        let resSq = 0;
        for (let k = 0; k < p; k++) {
          const f = intercept + slope[i]! * k;
          const r = c[i - p + 1 + k]! - f;
          resSq += r * r;
        }
        const sd = Math.sqrt(resSq / p);
        if (pos === 0) {
          if (c[i]! < fit - mult * sd) pos = 1;
          else if (c[i]! > fit + mult * sd) pos = -1;
        } else if ((pos === 1 && c[i]! >= fit) || (pos === -1 && c[i]! <= fit)) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },
];
