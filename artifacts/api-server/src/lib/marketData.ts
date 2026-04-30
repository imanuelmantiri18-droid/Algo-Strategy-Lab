import type { Candle, Interval } from "../types/strategy";
import { INTERVAL_MS, MAX_CANDLES_PER_INTERVAL } from "../types/strategy";
import { logger } from "./logger";

// data-api.binance.vision is the official Binance market-data subdomain (klines/depth/etc).
// It serves the exact same payload as api.binance.com but is unrestricted globally,
// so it works from Replit's data centers where api.binance.com returns 451.
const BINANCE_BASE = "https://data-api.binance.vision/api/v3/klines";
const SYMBOL = "BTCUSDT";
const PER_REQUEST_LIMIT = 1000;
const SHORT_CACHE_TTL_MS = 5 * 60_000; // 5 minutes — recent windows
const LONG_CACHE_TTL_MS = 15 * 60_000; // 15 minutes — historical >365d windows
const LONG_LOOKBACK_THRESHOLD_DAYS = 365;

function cacheTtlFor(lookbackDays: number): number {
  return lookbackDays > LONG_LOOKBACK_THRESHOLD_DAYS
    ? LONG_CACHE_TTL_MS
    : SHORT_CACHE_TTL_MS;
}

type CacheEntry = {
  candles: Candle[];
  fetchedAt: number;
  endTime: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Candle[]>>();

function bucketKey(interval: Interval, lookbackDays: number): string {
  // Key includes lookback so we cache distinct windows separately.
  return `${interval}:${lookbackDays}`;
}

function clampCandles(interval: Interval, requested: number): number {
  return Math.min(requested, MAX_CANDLES_PER_INTERVAL[interval]);
}

function targetCandleCount(interval: Interval, lookbackDays: number): number {
  const totalMs = lookbackDays * 24 * 60 * 60_000;
  const naive = Math.ceil(totalMs / INTERVAL_MS[interval]);
  return clampCandles(interval, naive);
}

function tsToIso(ms: number): string {
  return new Date(ms).toISOString();
}

async function fetchKlinesChunk(
  interval: Interval,
  endTime: number,
  limit: number,
): Promise<Candle[]> {
  const url = new URL(BINANCE_BASE);
  url.searchParams.set("symbol", SYMBOL);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("endTime", String(endTime));

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`Binance ${res.status}: ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as unknown[];
  if (!Array.isArray(raw)) throw new Error("Unexpected Binance response shape");

  const candles: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [openTime, o, h, l, c, v] = row as [
      number,
      string,
      string,
      string,
      string,
      string,
    ];
    candles.push({
      t: tsToIso(openTime),
      o: Number(o),
      h: Number(h),
      l: Number(l),
      c: Number(c),
      v: Number(v),
    });
  }
  return candles;
}

async function fetchHistory(interval: Interval, count: number): Promise<Candle[]> {
  const all: Candle[] = [];
  // Fetch backwards in time using endTime so we get the most recent N candles.
  let endTime = Date.now();
  let remaining = count;
  while (remaining > 0) {
    const limit = Math.min(PER_REQUEST_LIMIT, remaining);
    const chunk = await fetchKlinesChunk(interval, endTime, limit);
    if (chunk.length === 0) break;
    all.unshift(...chunk);
    // Advance endTime to just before the earliest candle in this chunk.
    const earliestMs = new Date(chunk[0]!.t).getTime();
    endTime = earliestMs - 1;
    remaining -= chunk.length;
    if (chunk.length < limit) break; // No more history
  }
  // Deduplicate (in case of overlap) and trim to requested length.
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

export async function getBtcHistory(
  interval: Interval,
  lookbackDays: number,
): Promise<Candle[]> {
  const count = targetCandleCount(interval, lookbackDays);
  const key = bucketKey(interval, lookbackDays);
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < cacheTtlFor(lookbackDays)) {
    return cached.candles;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const t0 = Date.now();
    const candles = await fetchHistory(interval, count);
    cache.set(key, { candles, fetchedAt: Date.now(), endTime: now });
    logger.info(
      { interval, lookbackDays, count: candles.length, ms: Date.now() - t0 },
      "fetched BTC klines from Binance",
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
