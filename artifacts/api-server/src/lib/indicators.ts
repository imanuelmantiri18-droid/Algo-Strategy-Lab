// Indicator math primitives shared by every strategy.
// All return arrays the same length as the input (warmup region filled with
// neutral defaults so generators can index without bounds checks).

export function sma(values: Float64Array, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0 || period < 1) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out[i] = i >= period - 1 ? sum / period : values[i]!;
  }
  return out;
}

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

export function wma(values: Float64Array, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const denom = (period * (period + 1)) / 2;
  for (let i = 0; i < n; i++) {
    if (i < period - 1) {
      out[i] = values[i]!;
      continue;
    }
    let s = 0;
    for (let k = 0; k < period; k++) s += values[i - k]! * (period - k);
    out[i] = s / denom;
  }
  return out;
}

export function hma(values: Float64Array, period: number): Float64Array {
  const half = Math.max(2, Math.floor(period / 2));
  const sqrtP = Math.max(2, Math.floor(Math.sqrt(period)));
  const wHalf = wma(values, half);
  const wFull = wma(values, period);
  const diff = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) diff[i] = 2 * wHalf[i]! - wFull[i]!;
  return wma(diff, sqrtP);
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
  let acc = 0;
  for (let i = 0; i < period && i < n; i++) acc += tr[i]!;
  out[period - 1] = acc / period;
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1]! * (period - 1) + tr[i]!) / period;
  }
  return out;
}

export function stddevRolling(values: Float64Array, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const m = sma(values, period);
  for (let i = period - 1; i < n; i++) {
    let s = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const d = values[k]! - m[i]!;
      s += d * d;
    }
    out[i] = Math.sqrt(s / period);
  }
  return out;
}

export function bollinger(
  closes: Float64Array,
  period: number,
  mult: number,
): { upper: Float64Array; mid: Float64Array; lower: Float64Array } {
  const mid = sma(closes, period);
  const sd = stddevRolling(closes, period);
  const n = closes.length;
  const upper = new Float64Array(n);
  const lower = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    upper[i] = mid[i]! + mult * sd[i]!;
    lower[i] = mid[i]! - mult * sd[i]!;
  }
  return { upper, mid, lower };
}

export function macd(
  closes: Float64Array,
  fast = 12,
  slow = 26,
  signalP = 9,
): { line: Float64Array; signal: Float64Array; hist: Float64Array } {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const n = closes.length;
  const line = new Float64Array(n);
  for (let i = 0; i < n; i++) line[i] = ef[i]! - es[i]!;
  const signal = ema(line, signalP);
  const hist = new Float64Array(n);
  for (let i = 0; i < n; i++) hist[i] = line[i]! - signal[i]!;
  return { line, signal, hist };
}

export function adx(
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
  period: number,
): { adx: Float64Array; plusDI: Float64Array; minusDI: Float64Array } {
  const n = highs.length;
  const tr = new Float64Array(n);
  const plusDM = new Float64Array(n);
  const minusDM = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const upMove = highs[i]! - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const h = highs[i]!;
    const l = lows[i]!;
    const pc = closes[i - 1]!;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  // Wilder smoothing
  const smTR = new Float64Array(n);
  const smP = new Float64Array(n);
  const smM = new Float64Array(n);
  let initTR = 0;
  let initP = 0;
  let initM = 0;
  for (let i = 1; i <= period && i < n; i++) {
    initTR += tr[i]!;
    initP += plusDM[i]!;
    initM += minusDM[i]!;
  }
  smTR[period] = initTR;
  smP[period] = initP;
  smM[period] = initM;
  for (let i = period + 1; i < n; i++) {
    smTR[i] = smTR[i - 1]! - smTR[i - 1]! / period + tr[i]!;
    smP[i] = smP[i - 1]! - smP[i - 1]! / period + plusDM[i]!;
    smM[i] = smM[i - 1]! - smM[i - 1]! / period + minusDM[i]!;
  }
  const plusDI = new Float64Array(n);
  const minusDI = new Float64Array(n);
  const dx = new Float64Array(n);
  for (let i = period; i < n; i++) {
    const t = smTR[i]!;
    plusDI[i] = t > 0 ? (100 * smP[i]!) / t : 0;
    minusDI[i] = t > 0 ? (100 * smM[i]!) / t : 0;
    const sum = plusDI[i]! + minusDI[i]!;
    dx[i] = sum > 0 ? (100 * Math.abs(plusDI[i]! - minusDI[i]!)) / sum : 0;
  }
  const adxArr = new Float64Array(n);
  let acc = 0;
  for (let i = period; i < period * 2 && i < n; i++) acc += dx[i]!;
  adxArr[period * 2 - 1] = acc / period;
  for (let i = period * 2; i < n; i++) {
    adxArr[i] = (adxArr[i - 1]! * (period - 1) + dx[i]!) / period;
  }
  return { adx: adxArr, plusDI, minusDI };
}

export function parabolicSAR(
  highs: Float64Array,
  lows: Float64Array,
  step = 0.02,
  max = 0.2,
): { sar: Float64Array; trend: Int8Array } {
  const n = highs.length;
  const sar = new Float64Array(n);
  const trend = new Int8Array(n);
  if (n < 2) return { sar, trend };
  let isLong = highs[1]! >= highs[0]!;
  let af = step;
  let ep = isLong ? highs[1]! : lows[1]!;
  sar[0] = isLong ? lows[0]! : highs[0]!;
  sar[1] = sar[0]!;
  trend[0] = isLong ? 1 : -1;
  trend[1] = trend[0]!;
  for (let i = 2; i < n; i++) {
    const prevSAR = sar[i - 1]!;
    let cur = prevSAR + af * (ep - prevSAR);
    if (isLong) {
      cur = Math.min(cur, lows[i - 1]!, lows[i - 2] ?? lows[i - 1]!);
      if (lows[i]! < cur) {
        // flip
        isLong = false;
        cur = ep;
        ep = lows[i]!;
        af = step;
      } else if (highs[i]! > ep) {
        ep = highs[i]!;
        af = Math.min(max, af + step);
      }
    } else {
      cur = Math.max(cur, highs[i - 1]!, highs[i - 2] ?? highs[i - 1]!);
      if (highs[i]! > cur) {
        isLong = true;
        cur = ep;
        ep = highs[i]!;
        af = step;
      } else if (lows[i]! < ep) {
        ep = lows[i]!;
        af = Math.min(max, af + step);
      }
    }
    sar[i] = cur;
    trend[i] = isLong ? 1 : -1;
  }
  return { sar, trend };
}

export function ichimoku(
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
): {
  tenkan: Float64Array;
  kijun: Float64Array;
  spanA: Float64Array;
  spanB: Float64Array;
  chikou: Float64Array;
} {
  const n = highs.length;
  const tenkan = new Float64Array(n);
  const kijun = new Float64Array(n);
  const spanA = new Float64Array(n);
  const spanB = new Float64Array(n);
  const chikou = new Float64Array(n);
  const hh = (i: number, p: number) => {
    let m = -Infinity;
    for (let k = Math.max(0, i - p + 1); k <= i; k++) m = Math.max(m, highs[k]!);
    return m;
  };
  const ll = (i: number, p: number) => {
    let m = Infinity;
    for (let k = Math.max(0, i - p + 1); k <= i; k++) m = Math.min(m, lows[k]!);
    return m;
  };
  for (let i = 0; i < n; i++) {
    tenkan[i] = (hh(i, 9) + ll(i, 9)) / 2;
    kijun[i] = (hh(i, 26) + ll(i, 26)) / 2;
    spanA[i] = (tenkan[i]! + kijun[i]!) / 2;
    spanB[i] = (hh(i, 52) + ll(i, 52)) / 2;
    chikou[i] = i + 26 < n ? closes[i + 26] ?? closes[i]! : closes[i]!;
  }
  return { tenkan, kijun, spanA, spanB, chikou };
}

export function supertrend(
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
  atrSeries: Float64Array,
  mult: number,
): { line: Float64Array; trend: Int8Array } {
  const n = highs.length;
  const line = new Float64Array(n);
  const trend = new Int8Array(n);
  let prevUpper = 0;
  let prevLower = 0;
  let prevTrend: 1 | -1 = 1;
  for (let i = 0; i < n; i++) {
    const mid = (highs[i]! + lows[i]!) / 2;
    const a = atrSeries[i] ?? 0;
    let upper = mid + mult * a;
    let lower = mid - mult * a;
    if (i > 0) {
      if (closes[i - 1]! <= prevUpper) upper = Math.min(upper, prevUpper);
      if (closes[i - 1]! >= prevLower) lower = Math.max(lower, prevLower);
    }
    let t: 1 | -1 = prevTrend;
    if (closes[i]! > prevUpper) t = 1;
    else if (closes[i]! < prevLower) t = -1;
    line[i] = t === 1 ? lower : upper;
    trend[i] = t;
    prevTrend = t;
    prevUpper = upper;
    prevLower = lower;
  }
  return { line, trend };
}

export function donchian(
  highs: Float64Array,
  lows: Float64Array,
  period: number,
): { upper: Float64Array; lower: Float64Array; mid: Float64Array } {
  const n = highs.length;
  const upper = new Float64Array(n);
  const lower = new Float64Array(n);
  const mid = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    const start = Math.max(0, i - period + 1);
    for (let k = start; k <= i; k++) {
      if (highs[k]! > hi) hi = highs[k]!;
      if (lows[k]! < lo) lo = lows[k]!;
    }
    upper[i] = hi;
    lower[i] = lo;
    mid[i] = (hi + lo) / 2;
  }
  return { upper, lower, mid };
}

export function stochastic(
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
  kPeriod: number,
  dPeriod: number,
): { k: Float64Array; d: Float64Array } {
  const n = closes.length;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - kPeriod + 1);
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = start; j <= i; j++) {
      if (highs[j]! > hi) hi = highs[j]!;
      if (lows[j]! < lo) lo = lows[j]!;
    }
    k[i] = hi - lo > 0 ? ((closes[i]! - lo) / (hi - lo)) * 100 : 50;
  }
  const d = sma(k, dPeriod);
  return { k, d };
}

export function williamsR(
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
  period: number,
): Float64Array {
  const n = closes.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - period + 1);
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = start; j <= i; j++) {
      if (highs[j]! > hi) hi = highs[j]!;
      if (lows[j]! < lo) lo = lows[j]!;
    }
    out[i] = hi - lo > 0 ? ((hi - closes[i]!) / (hi - lo)) * -100 : -50;
  }
  return out;
}

export function cci(
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
  period: number,
): Float64Array {
  const n = closes.length;
  const tp = new Float64Array(n);
  for (let i = 0; i < n; i++) tp[i] = (highs[i]! + lows[i]! + closes[i]!) / 3;
  const m = sma(tp, period);
  const out = new Float64Array(n);
  for (let i = period - 1; i < n; i++) {
    let mad = 0;
    for (let k = i - period + 1; k <= i; k++) mad += Math.abs(tp[k]! - m[i]!);
    mad /= period;
    out[i] = mad > 0 ? (tp[i]! - m[i]!) / (0.015 * mad) : 0;
  }
  return out;
}

export function zscore(values: Float64Array, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const m = sma(values, period);
  const sd = stddevRolling(values, period);
  for (let i = 0; i < n; i++) out[i] = sd[i]! > 0 ? (values[i]! - m[i]!) / sd[i]! : 0;
  return out;
}

export function vwap(
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
  volumes: Float64Array,
  resetEvery: number,
): Float64Array {
  const n = closes.length;
  const out = new Float64Array(n);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < n; i++) {
    if (resetEvery > 0 && i % resetEvery === 0) {
      cumPV = 0;
      cumV = 0;
    }
    const tp = (highs[i]! + lows[i]! + closes[i]!) / 3;
    cumPV += tp * volumes[i]!;
    cumV += volumes[i]!;
    out[i] = cumV > 0 ? cumPV / cumV : tp;
  }
  return out;
}

export function keltner(
  closes: Float64Array,
  atrSeries: Float64Array,
  emaPeriod: number,
  mult: number,
): { upper: Float64Array; mid: Float64Array; lower: Float64Array } {
  const mid = ema(closes, emaPeriod);
  const n = closes.length;
  const upper = new Float64Array(n);
  const lower = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    upper[i] = mid[i]! + mult * (atrSeries[i] ?? 0);
    lower[i] = mid[i]! - mult * (atrSeries[i] ?? 0);
  }
  return { upper, mid, lower };
}

export function linRegSlope(values: Float64Array, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const sumX = (period * (period - 1)) / 2;
  const sumX2 = ((period - 1) * period * (2 * period - 1)) / 6;
  const denom = period * sumX2 - sumX * sumX;
  for (let i = period - 1; i < n; i++) {
    let sumY = 0;
    let sumXY = 0;
    for (let k = 0; k < period; k++) {
      const y = values[i - period + 1 + k]!;
      sumY += y;
      sumXY += k * y;
    }
    out[i] = denom > 0 ? (period * sumXY - sumX * sumY) / denom : 0;
  }
  return out;
}

export function heikinAshi(candles: { o: number; h: number; l: number; c: number }[]) {
  const n = candles.length;
  const o = new Float64Array(n);
  const h = new Float64Array(n);
  const l = new Float64Array(n);
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cd = candles[i]!;
    c[i] = (cd.o + cd.h + cd.l + cd.c) / 4;
    o[i] = i === 0 ? (cd.o + cd.c) / 2 : (o[i - 1]! + c[i - 1]!) / 2;
    h[i] = Math.max(cd.h, o[i]!, c[i]!);
    l[i] = Math.min(cd.l, o[i]!, c[i]!);
  }
  return { o, h, l, c };
}
