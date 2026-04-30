import type { Candle } from "../types/strategy";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const SEED = 1337;
const HISTORY_DAYS = 1825;

let cachedCandles: Candle[] | null = null;

function generate(): Candle[] {
  const rng = mulberry32(SEED);
  const candles: Candle[] = [];
  let price = 9_500;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);

    const idx = HISTORY_DAYS - 1 - i;
    const trendCycle =
      Math.sin((idx / HISTORY_DAYS) * Math.PI * 4) * 0.0015 +
      Math.sin((idx / HISTORY_DAYS) * Math.PI * 11) * 0.0008;
    const drift = 0.0009 + trendCycle;
    const vol = 0.034 + Math.abs(Math.sin(idx / 90)) * 0.012;
    const shock = gauss(rng) * vol;
    const ret = drift + shock;

    const open = price;
    const close = Math.max(800, open * (1 + ret));
    const intraVol = vol * 0.7;
    const hi = Math.max(open, close) * (1 + Math.abs(gauss(rng)) * intraVol * 0.5);
    const lo = Math.min(open, close) * (1 - Math.abs(gauss(rng)) * intraVol * 0.5);

    candles.push({
      t: date.toISOString().slice(0, 10),
      o: round2(open),
      h: round2(hi),
      l: round2(lo),
      c: round2(close),
    });
    price = close;
  }
  return candles;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function getBtcHistory(days: number): Candle[] {
  if (!cachedCandles) cachedCandles = generate();
  const clamped = Math.min(Math.max(days, 30), HISTORY_DAYS);
  return cachedCandles.slice(cachedCandles.length - clamped);
}
