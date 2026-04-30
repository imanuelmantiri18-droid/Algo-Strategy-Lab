// F. Advanced / Statistical / AI (5 strategies, IDs 46-50).
// Several of these (Pairs, Sentiment, RF/HMM/ARIMA) need either a second
// asset's price stream, an external NLP API, or a model-training pipeline.
// We mark those as `available: false` and ship deterministic implementations
// for HMM-style regime gating and a moving-window linear-regression "ARIMA-lite"
// price-band model.
import type { Candle, Signal, StrategyDef } from "../../types/strategy";
import { ema, sma as smaFn, stddevRolling, atr as atrFn, rsi as rsiFn } from "../indicators";

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

export const ADVANCED_STRATEGIES: StrategyDef[] = [
  // 46. Pairs trading — UNAVAILABLE without ETH series
  {
    id: "adv_pairs_trade",
    name: "Statistical Pairs (BTC/ETH)",
    tagline: "Requires ETH price stream alongside BTC (unavailable).",
    description:
      "Computes the rolling correlation/spread of BTC vs ETH. Long the underperformer, short the outperformer when the spread Z-score exceeds a threshold. Needs simultaneous ETH OHLCV — not currently fetched.",
    category: "advanced",
    risk: "medium",
    available: false,
    unavailableReason: "Requires synchronous ETH OHLCV alongside BTC — second-asset feed not implemented.",
    params: [],
    generateSignals(candles) {
      return new Array(candles.length).fill(0);
    },
  },
  // 47. Sentiment Analysis — UNAVAILABLE without Twitter/news API
  {
    id: "adv_sentiment",
    name: "Sentiment Trigger",
    tagline: "Requires X/News + LLM API (unavailable).",
    description:
      "Subscribes to Twitter/X or a news feed, scores headlines via an NLP model, and trades when sentiment is at extremes. Needs an external API — not configured here.",
    category: "advanced",
    risk: "extreme",
    available: false,
    unavailableReason: "Requires X/News API + LLM scoring — not configured in this environment.",
    params: [],
    generateSignals(candles) {
      return new Array(candles.length).fill(0);
    },
  },
  // 48. Random Forest classifier — UNAVAILABLE without offline training
  {
    id: "adv_random_forest",
    name: "Random Forest Direction",
    tagline: "Needs offline ML training pipeline (unavailable).",
    description:
      "Trains a Random Forest classifier on historical OHLCV + indicator features to predict next-bar direction. Requires offline training and persisted model weights — not part of this lab.",
    category: "advanced",
    risk: "extreme",
    available: false,
    unavailableReason: "Requires offline model training and persisted weights — out of scope for this realtime backtester.",
    params: [],
    generateSignals(candles) {
      return new Array(candles.length).fill(0);
    },
  },
  // 49. HMM regime filter (deterministic 3-regime classifier on volatility + slope)
  {
    id: "adv_hmm_regime",
    name: "Regime-Switch Strategy",
    tagline: "HMM-style classifier toggles trend vs mean-revert sub-strategies.",
    description:
      "Classifies the current regime as TRENDING (slope-up + low vol), VOLATILE (high vol), or RANGING (low slope + low vol). In TRENDING follow EMA20>EMA50; in RANGING fade Bollinger extremes; in VOLATILE stay flat.",
    category: "advanced",
    risk: "medium",
    available: true,
    params: [
      { key: "volPeriod", label: "Vol Window", type: "number", default: 30, min: 10, max: 100, step: 1 },
      { key: "slopePeriod", label: "Slope Window", type: "number", default: 50, min: 10, max: 200, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const volP = Math.round(params.volPeriod ?? 30);
      const slopeP = Math.round(params.slopePeriod ?? 50);
      const ret = new Float64Array(c.length);
      for (let i = 1; i < c.length; i++) ret[i] = (c[i]! - c[i - 1]!) / c[i - 1]!;
      const vol = stddevRolling(ret, volP);
      const slopeMA = smaFn(c, slopeP);
      const e20 = ema(c, 20);
      const e50 = ema(c, 50);
      const a = atrFn(h, l, c, 14);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = slopeP; i < candles.length; i++) {
        const slope = (slopeMA[i]! - slopeMA[i - slopeP / 2]!) / slopeMA[i]!;
        const volRel = vol[i]! / (vol[Math.max(0, i - 1)] || 1);
        const isVolatile = vol[i]! > 0.025; // 2.5% per-bar stdev
        const isTrending = Math.abs(slope) > 0.005 && !isVolatile;
        if (isVolatile) {
          pos = 0;
        } else if (isTrending) {
          if (e20[i]! > e50[i]!) pos = 1;
          else if (e20[i]! < e50[i]!) pos = -1;
        } else {
          // ranging — fade BB equivalent: use ATR envelope
          const upper = slopeMA[i]! + 1.5 * a[i]!;
          const lower = slopeMA[i]! - 1.5 * a[i]!;
          if (c[i]! > upper) pos = -1;
          else if (c[i]! < lower) pos = 1;
          else if ((pos === 1 && c[i]! >= slopeMA[i]!) || (pos === -1 && c[i]! <= slopeMA[i]!)) pos = 0;
        }
        out[i] = pos;
        // suppress unused warning for volRel — kept for future regime tuning
        void volRel;
      }
      return out;
    },
  },
  // 50. ARIMA/GARCH-lite price band (rolling linear forecast + vol-of-vol bands)
  {
    id: "adv_arima_band",
    name: "ARIMA-Lite Forecast Band",
    tagline: "Linear forecast ± GARCH-style vol bands.",
    description:
      "Fits a rolling AR(1)-style trend (linear regression slope) and projects the next bar. Bands = ±k × rolling stdev. Long if price < lower projection; short if > upper. Exit at the projection mean.",
    category: "advanced",
    risk: "medium",
    available: true,
    params: [
      { key: "window", label: "Window", type: "number", default: 50, min: 20, max: 200, step: 1 },
      { key: "kBand", label: "Band ×σ", type: "number", default: 2, min: 1, max: 4, step: 0.25 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const win = Math.round(params.window ?? 50);
      const k = params.kBand ?? 2;
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = win; i < candles.length; i++) {
        // linear regression slope+intercept on closes[i-win+1 .. i]
        const n = win;
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumX2 = 0;
        for (let kk = 0; kk < n; kk++) {
          const x = kk;
          const y = c[i - n + 1 + kk]!;
          sumX += x;
          sumY += y;
          sumXY += x * y;
          sumX2 += x * x;
        }
        const denom = n * sumX2 - sumX * sumX;
        const slope = denom > 0 ? (n * sumXY - sumX * sumY) / denom : 0;
        const intercept = (sumY - slope * sumX) / n;
        const forecast = intercept + slope * n;
        // residual stdev
        let resSq = 0;
        for (let kk = 0; kk < n; kk++) {
          const f = intercept + slope * kk;
          const r = c[i - n + 1 + kk]! - f;
          resSq += r * r;
        }
        const sd = Math.sqrt(resSq / n);
        const upper = forecast + k * sd;
        const lower = forecast - k * sd;
        if (pos === 0) {
          if (c[i]! < lower) pos = 1;
          else if (c[i]! > upper) pos = -1;
        } else if ((pos === 1 && c[i]! >= forecast) || (pos === -1 && c[i]! <= forecast)) {
          pos = 0;
        }
        out[i] = pos;
      }
      return out;
    },
  },
];

// Suppress unused imports warning (rsiFn reserved for future strategies).
void rsiFn;
