import type { Candle, Interval } from "../types/strategy";
import { INTERVAL_MS, MAX_CANDLES_PER_INTERVAL } from "../types/strategy";
import { logger } from "./logger";

const HL_BASE = "https://api.hyperliquid.xyz/info";
const PER_REQUEST_LIMIT = 5000;
const CACHE_TTL_MS = 5 * 60_000;

type HlCandle = {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
};

const cache = new Map<string, { candles: Candle[]; fetchedAt: number }>();
const inflight = new Map<string, Promise<Candle[]>>();

function cacheKey(coin: string, interval: Interval, lookbackDays: number): string {
  return `hl:${coin}:${interval}:${lookbackDays}`;
}

function targetCandleCount(interval: Interval, lookbackDays: number): number {
  const totalMs = lookbackDays * 24 * 60 * 60_000;
  const naive = Math.ceil(totalMs / INTERVAL_MS[interval]);
  return Math.min(naive, MAX_CANDLES_PER_INTERVAL[interval]);
}

async function fetchHlChunk(
  coin: string,
  interval: Interval,
  startTime: number,
  endTime: number,
): Promise<Candle[]> {
  const res = await fetch(HL_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime, endTime },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`Hyperliquid ${res.status}: ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) throw new Error("Unexpected Hyperliquid response shape");
  return (raw as HlCandle[]).map((c) => ({
    t: new Date(c.t).toISOString(),
    o: Number(c.o),
    h: Number(c.h),
    l: Number(c.l),
    c: Number(c.c),
    v: Number(c.v),
  }));
}

async function fetchHlHistory(
  coin: string,
  interval: Interval,
  count: number,
): Promise<Candle[]> {
  const all: Candle[] = [];
  let endTime = Date.now();
  let remaining = count;

  while (remaining > 0) {
    const limit = Math.min(PER_REQUEST_LIMIT, remaining);
    const intervalMs = INTERVAL_MS[interval];
    const startTime = endTime - limit * intervalMs * 1.05;
    const chunk = await fetchHlChunk(coin, interval, Math.floor(startTime), endTime);
    if (chunk.length === 0) break;
    all.unshift(...chunk);
    const earliestMs = new Date(chunk[0]!.t).getTime();
    endTime = earliestMs - 1;
    remaining -= chunk.length;
    if (chunk.length < limit) break;
  }

  const seen = new Set<string>();
  const dedup: Candle[] = [];
  for (const c of all) {
    if (seen.has(c.t)) continue;
    seen.add(c.t);
    dedup.push(c);
  }
  dedup.sort((a, b) => a.t.localeCompare(b.t));
  return dedup.slice(-count);
}

export async function getHlHistory(
  coin: string,
  interval: Interval,
  lookbackDays: number,
): Promise<Candle[]> {
  const count = targetCandleCount(interval, lookbackDays);
  const key = cacheKey(coin, interval, lookbackDays);
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.candles;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const t0 = Date.now();
    const candles = await fetchHlHistory(coin, interval, count);
    cache.set(key, { candles, fetchedAt: Date.now() });
    logger.info(
      { coin, interval, lookbackDays, count: candles.length, ms: Date.now() - t0 },
      "fetched klines from Hyperliquid",
    );
    return candles;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}
