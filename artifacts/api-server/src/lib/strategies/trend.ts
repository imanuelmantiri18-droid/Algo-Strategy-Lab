// B. Trend Following & Momentum (10 strategies, IDs 11-20 + the legacy
// momentum_trend_cross which is functionally similar to triple_ema_cross).
import type { Candle, Signal, StrategyDef } from "../../types/strategy";
import {
  adx,
  donchian,
  ema,
  hma,
  ichimoku,
  macd,
  parabolicSAR,
  rsi,
  supertrend,
  atr as atrFn,
  heikinAshi,
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

function holdSignals(entries: (-1 | 0 | 1)[], exits?: boolean[]): Signal[] {
  const n = entries.length;
  const out: Signal[] = new Array(n).fill(0);
  let pos: Signal = 0;
  for (let i = 0; i < n; i++) {
    if (exits && exits[i]) pos = 0;
    const e = entries[i] ?? 0;
    if (e !== 0) pos = e as Signal;
    out[i] = pos;
  }
  return out;
}

export const TREND_STRATEGIES: StrategyDef[] = [
  // Legacy strategy — kept for backward compatibility with saved configs.
  {
    id: "momentum_trend_cross",
    name: "Momentum Trend Crossover",
    tagline: "EMA crossover gated by RSI momentum filter.",
    description:
      "Long when fast EMA crosses above slow EMA AND RSI(14) > threshold (momentum confirms uptrend). Short when fast EMA crosses below slow EMA AND RSI(14) < (100 - threshold). Pairs with ATR stops and an R:R take-profit.",
    category: "trend",
    risk: "high",
    params: [
      { key: "emaFast", label: "EMA Fast", type: "number", default: 20, min: 5, max: 100, step: 1 },
      { key: "emaSlow", label: "EMA Slow", type: "number", default: 50, min: 20, max: 400, step: 1 },
      { key: "rsiPeriod", label: "RSI Period", type: "number", default: 14, min: 5, max: 50, step: 1 },
      { key: "rsiThreshold", label: "RSI Threshold", type: "number", default: 50, min: 30, max: 70, step: 1 },
      { key: "allowShort", label: "Allow Shorts (1=yes 0=no)", type: "number", default: 1, min: 0, max: 1, step: 1 },
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
        const crossUp = fast[i - 1]! <= slow[i - 1]! && fast[i]! > slow[i]!;
        const crossDn = fast[i - 1]! >= slow[i - 1]! && fast[i]! < slow[i]!;
        if (crossUp && r[i]! > thr) pos = 1;
        else if (crossDn && r[i]! < 100 - thr && allowShort) pos = -1;
        else if (crossUp || crossDn) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },
  // 11. Triple EMA Crossover
  {
    id: "triple_ema_cross",
    name: "Triple EMA Crossover",
    tagline: "EMA9 × EMA21 cross filtered by EMA200 trend.",
    description:
      "Long when EMA9 crosses above EMA21 AND price > EMA200. Short when EMA9 crosses below EMA21 AND price < EMA200. The EMA200 acts as a long-term trend filter.",
    category: "trend",
    risk: "medium",
    params: [
      { key: "emaA", label: "EMA Short", type: "number", default: 9, min: 3, max: 30, step: 1 },
      { key: "emaB", label: "EMA Mid", type: "number", default: 21, min: 8, max: 60, step: 1 },
      { key: "emaC", label: "EMA Long", type: "number", default: 200, min: 50, max: 400, step: 5 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const a = ema(c, Math.round(params.emaA ?? 9));
      const b = ema(c, Math.round(params.emaB ?? 21));
      const cl = ema(c, Math.round(params.emaC ?? 200));
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 1; i < candles.length; i++) {
        const up = a[i - 1]! <= b[i - 1]! && a[i]! > b[i]!;
        const dn = a[i - 1]! >= b[i - 1]! && a[i]! < b[i]!;
        if (up && c[i]! > cl[i]!) pos = 1;
        else if (dn && c[i]! < cl[i]!) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  // 12. MACD Zero-Cross with volume confirmation
  {
    id: "macd_zero_cross",
    name: "MACD Zero-Line Cross",
    tagline: "Trade MACD line crossing zero with above-avg volume.",
    description:
      "Long when MACD line crosses above zero AND current bar volume > 20-bar average volume. Short on inverse cross with same volume condition.",
    category: "trend",
    risk: "medium",
    params: [
      { key: "fast", label: "MACD Fast", type: "number", default: 12, min: 5, max: 30, step: 1 },
      { key: "slow", label: "MACD Slow", type: "number", default: 26, min: 15, max: 60, step: 1 },
      { key: "signal", label: "MACD Signal", type: "number", default: 9, min: 3, max: 20, step: 1 },
      { key: "volMult", label: "Volume × Avg", type: "number", default: 1, min: 0.5, max: 3, step: 0.1 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const v = vols(candles);
      const m = macd(c, Math.round(params.fast ?? 12), Math.round(params.slow ?? 26), Math.round(params.signal ?? 9));
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      const volMult = params.volMult ?? 1;
      const period = 20;
      let volSum = 0;
      for (let i = 0; i < candles.length; i++) {
        volSum += v[i]!;
        if (i >= period) volSum -= v[i - period]!;
        const avgV = i >= period - 1 ? volSum / period : 0;
        const up = i > 0 && m.line[i - 1]! <= 0 && m.line[i]! > 0;
        const dn = i > 0 && m.line[i - 1]! >= 0 && m.line[i]! < 0;
        const volOK = avgV > 0 && v[i]! >= avgV * volMult;
        if (up && volOK) pos = 1;
        else if (dn && volOK) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  // 13. ADX & DI cross
  {
    id: "adx_di_cross",
    name: "ADX + DI Cross",
    tagline: "Trade DI+/DI- cross only when ADX > threshold.",
    description:
      "Long when DI+ crosses above DI- AND ADX > threshold (default 25). Short on inverse. ADX filter ensures we only trade strongly trending markets.",
    category: "trend",
    risk: "medium",
    params: [
      { key: "period", label: "ADX Period", type: "number", default: 14, min: 7, max: 30, step: 1 },
      { key: "threshold", label: "ADX Threshold", type: "number", default: 25, min: 15, max: 40, step: 1 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const p = Math.round(params.period ?? 14);
      const thr = params.threshold ?? 25;
      const a = adx(h, l, c, p);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 1; i < candles.length; i++) {
        const up = a.plusDI[i - 1]! <= a.minusDI[i - 1]! && a.plusDI[i]! > a.minusDI[i]!;
        const dn = a.plusDI[i - 1]! >= a.minusDI[i - 1]! && a.plusDI[i]! < a.minusDI[i]!;
        if (up && a.adx[i]! > thr) pos = 1;
        else if (dn && a.adx[i]! > thr) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  // 14. Parabolic SAR
  {
    id: "parabolic_sar",
    name: "Parabolic SAR Stop & Reverse",
    tagline: "Always-in stop-and-reverse on Parabolic SAR flip.",
    description:
      "Always in the market: long when SAR is below price, short when SAR is above. Direction flips on each Parabolic SAR reversal.",
    category: "trend",
    risk: "high",
    params: [
      { key: "step", label: "AF Step", type: "number", default: 0.02, min: 0.005, max: 0.1, step: 0.005 },
      { key: "max", label: "AF Max", type: "number", default: 0.2, min: 0.05, max: 0.5, step: 0.05 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const sar = parabolicSAR(h, l, params.step ?? 0.02, params.max ?? 0.2);
      const out: Signal[] = new Array(candles.length).fill(0);
      for (let i = 0; i < candles.length; i++) out[i] = sar.trend[i] === 1 ? 1 : -1;
      return out;
    },
  },
  // 15. Ichimoku Cloud Breakout
  {
    id: "ichimoku_breakout",
    name: "Ichimoku Cloud Breakout",
    tagline: "Price breaks the Kumo cloud with Chikou clear.",
    description:
      "Long when price closes above the Kumo cloud (max of spanA/spanB) AND tenkan > kijun. Short when price closes below the cloud AND tenkan < kijun.",
    category: "trend",
    risk: "medium",
    params: [],
    generateSignals(candles) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const ic = ichimoku(h, l, c);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 0; i < candles.length; i++) {
        const cloudHi = Math.max(ic.spanA[i]!, ic.spanB[i]!);
        const cloudLo = Math.min(ic.spanA[i]!, ic.spanB[i]!);
        if (c[i]! > cloudHi && ic.tenkan[i]! > ic.kijun[i]!) pos = 1;
        else if (c[i]! < cloudLo && ic.tenkan[i]! < ic.kijun[i]!) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  // 16. Supertrend Pullback
  {
    id: "supertrend_pullback",
    name: "Supertrend Trend Rider",
    tagline: "Follow Supertrend direction; flip on color change.",
    description:
      "Long when Supertrend turns green (line below price). Short when it turns red. Stays in the position until the next color flip.",
    category: "trend",
    risk: "medium",
    params: [
      { key: "atrPeriod", label: "ATR Period", type: "number", default: 10, min: 5, max: 30, step: 1 },
      { key: "mult", label: "ATR Multiplier", type: "number", default: 3, min: 1, max: 6, step: 0.5 },
    ],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const a = atrFn(h, l, c, Math.round(params.atrPeriod ?? 10));
      const st = supertrend(h, l, c, a, params.mult ?? 3);
      const out: Signal[] = new Array(candles.length).fill(0);
      for (let i = 0; i < candles.length; i++) out[i] = st.trend[i] === 1 ? 1 : -1;
      return out;
    },
  },
  // 17. Donchian Channel Breakout
  {
    id: "donchian_trend",
    name: "Donchian Channel Trend",
    tagline: "Long on 20-bar high break; exit at midline.",
    description:
      "Long when price closes at a new 20-bar high. Short on new 20-bar low. Exit when price returns to the channel mid.",
    category: "trend",
    risk: "medium",
    params: [{ key: "period", label: "Donchian Period", type: "number", default: 20, min: 5, max: 60, step: 1 }],
    generateSignals(candles, params) {
      const h = highs(candles);
      const l = lows(candles);
      const c = closes(candles);
      const p = Math.round(params.period ?? 20);
      const d = donchian(h, l, p);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = p; i < candles.length; i++) {
        if (c[i]! >= d.upper[i - 1]! - 1e-9) pos = 1;
        else if (c[i]! <= d.lower[i - 1]! + 1e-9) pos = -1;
        else if ((pos === 1 && c[i]! < d.mid[i]!) || (pos === -1 && c[i]! > d.mid[i]!)) pos = 0;
        out[i] = pos;
      }
      return out;
    },
  },
  // 18. Hull Moving Average turn
  {
    id: "hma_turn",
    name: "Hull MA Turn",
    tagline: "Direction follows the slope of the HMA.",
    description:
      "Long when HMA slopes up (HMA[i] > HMA[i-1]). Short when it slopes down. The Hull MA is more responsive than EMA, so flips happen quickly.",
    category: "trend",
    risk: "high",
    params: [{ key: "period", label: "HMA Period", type: "number", default: 21, min: 7, max: 100, step: 1 }],
    generateSignals(candles, params) {
      const c = closes(candles);
      const h = hma(c, Math.round(params.period ?? 21));
      const out: Signal[] = new Array(candles.length).fill(0);
      for (let i = 1; i < candles.length; i++) out[i] = h[i]! > h[i - 1]! ? 1 : -1;
      return out;
    },
  },
  // 19. RSI Trendline Breakout (simplified: RSI break of own EMA + price)
  {
    id: "rsi_trendline_break",
    name: "RSI Trend Break",
    tagline: "RSI breaks its own EMA before price does.",
    description:
      "Long when RSI(14) crosses above its own EMA(21) and is above 50. Short when RSI crosses below its own EMA(21) and is below 50. Catches momentum shifts before price.",
    category: "trend",
    risk: "high",
    params: [
      { key: "rsiPeriod", label: "RSI Period", type: "number", default: 14, min: 7, max: 30, step: 1 },
      { key: "smoothPeriod", label: "RSI EMA", type: "number", default: 21, min: 7, max: 50, step: 1 },
    ],
    generateSignals(candles, params) {
      const c = closes(candles);
      const r = rsi(c, Math.round(params.rsiPeriod ?? 14));
      const re = ema(r, Math.round(params.smoothPeriod ?? 21));
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      for (let i = 1; i < candles.length; i++) {
        const up = r[i - 1]! <= re[i - 1]! && r[i]! > re[i]! && r[i]! > 50;
        const dn = r[i - 1]! >= re[i - 1]! && r[i]! < re[i]! && r[i]! < 50;
        if (up) pos = 1;
        else if (dn) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
  // 20. Heikin-Ashi Trend Rider
  {
    id: "heikin_ashi_rider",
    name: "Heikin-Ashi Trend Rider",
    tagline: "Two consecutive HA candles with no opposite wick.",
    description:
      "Long after 2 consecutive green Heikin-Ashi candles with no lower shadow (strong uptrend). Short after 2 consecutive red HA candles with no upper shadow.",
    category: "trend",
    risk: "medium",
    params: [{ key: "streak", label: "HA Streak", type: "number", default: 2, min: 1, max: 5, step: 1 }],
    generateSignals(candles, params) {
      const ha = heikinAshi(candles);
      const need = Math.round(params.streak ?? 2);
      const out: Signal[] = new Array(candles.length).fill(0);
      let pos: Signal = 0;
      let upStreak = 0;
      let dnStreak = 0;
      for (let i = 0; i < candles.length; i++) {
        const o = ha.o[i]!;
        const h = ha.h[i]!;
        const l = ha.l[i]!;
        const c = ha.c[i]!;
        const greenNoLow = c > o && Math.abs(l - Math.min(o, c)) < (h - l) * 0.05;
        const redNoUp = c < o && Math.abs(h - Math.max(o, c)) < (h - l) * 0.05;
        if (greenNoLow) {
          upStreak++;
          dnStreak = 0;
        } else if (redNoUp) {
          dnStreak++;
          upStreak = 0;
        } else {
          upStreak = 0;
          dnStreak = 0;
        }
        if (upStreak >= need) pos = 1;
        else if (dnStreak >= need) pos = -1;
        out[i] = pos;
      }
      return out;
    },
  },
];

export { holdSignals };
