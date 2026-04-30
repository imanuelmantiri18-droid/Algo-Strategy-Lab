/**
 * Live trading bot for Binance USDT-M Futures TESTNET (paper money).
 *
 * IMPORTANT: This file is a CONNECTION LAYER ONLY. It does NOT modify any
 * existing strategy logic, indicator code, backtest engine, or default config.
 * It re-uses `getStrategy`, `atr`, `highsArr`, `lowsArr`, `closesArr` straight
 * from `../lib/strategies` so the live signals are bit-for-bit the same as the
 * backtest signals. Risk parameters (ATR×1.5 SL, R:R 1:2) are taken from the
 * same DEFAULT_RISK numbers used by `runEngine` in `../lib/backtest`.
 *
 * USAGE:
 *   pnpm --filter @workspace/api-server run live -- [flags]
 *
 * FLAGS:
 *   --strategy=<id>     strategy id (default: fractal_breakout — tournament champion)
 *   --interval=<tf>     candle timeframe: 5m|15m|30m|1h|2h|4h|1d (default: 1h)
 *   --leverage=<n>      leverage 1..125 (default: 20)
 *   --risk=<pct>        risk per trade % of capital (default: 10)
 *   --capital=<usdt>    notional sizing basis in USDT (default: 100)
 *   --symbol=<sym>      trading pair (default: BTCUSDT)
 *   --dry-run           do everything except actually placing orders
 *   --once              evaluate once and exit (useful for testing)
 *
 * REQUIRED ENV:
 *   BINANCE_TESTNET_API_KEY      — from https://testnet.binancefuture.com → API Keys
 *   BINANCE_TESTNET_API_SECRET   — same place
 *
 * Defaults match the screenshot: BTCUSDT, 1H, 20× leverage, 10% risk, $100.
 */

import crypto from "node:crypto";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  STRATEGIES,
  getStrategy,
  atr,
  highsArr,
  lowsArr,
  closesArr,
} from "../lib/strategies";
import type { Candle, Interval, Signal } from "../types/strategy";
import { INTERVAL_MS } from "../types/strategy";

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const TESTNET_BASE = "https://testnet.binancefuture.com";

// Risk knobs — MIRROR DEFAULT_RISK in artifacts/strategy-lab/src/components/LabControls.tsx
// (kept here as constants so we don't have to import frontend code from the API server).
// If you change DEFAULT_RISK in the lab, change these too — they are intentionally
// duplicated so the bot's risk shape always matches the backtest engine.
const ATR_PERIOD = 14;
const ATR_MULT_SL = 1.5;
const RR_RATIO = 2;
const POLL_INTERVAL_MS = 5_000; // how often we re-check the latest closed candle

type CliConfig = {
  strategyId: string;
  interval: Interval;
  leverage: number;
  riskPct: number;
  capital: number;
  symbol: string;
  dryRun: boolean;
  once: boolean;
};

function parseArgs(argv: string[]): CliConfig {
  const flags: Record<string, string | boolean> = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) flags[a.slice(2)] = true;
    else flags[a.slice(2, eq)] = a.slice(eq + 1);
  }
  const interval = (flags.interval ?? "1h") as Interval;
  if (!(interval in INTERVAL_MS)) {
    throw new Error(`Invalid --interval=${interval}. Allowed: ${Object.keys(INTERVAL_MS).join(", ")}`);
  }
  return {
    strategyId: String(flags.strategy ?? "fractal_breakout"),
    interval,
    leverage: Number(flags.leverage ?? 20),
    riskPct: Number(flags.risk ?? 10),
    capital: Number(flags.capital ?? 100),
    symbol: String(flags.symbol ?? "BTCUSDT"),
    dryRun: Boolean(flags["dry-run"]),
    once: Boolean(flags.once),
  };
}

// ---------------------------------------------------------------------------
// LOGGING
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function log(...args: unknown[]): void {
  console.log(`[${ts()}]`, ...args);
}
function warn(...args: unknown[]): void {
  console.warn(`[${ts()}] ⚠`, ...args);
}
function err(...args: unknown[]): void {
  console.error(`[${ts()}] ✗`, ...args);
}

// ---------------------------------------------------------------------------
// BINANCE TESTNET REST CLIENT
// ---------------------------------------------------------------------------

class BinanceTestnetClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  private sign(query: string): string {
    return crypto.createHmac("sha256", this.apiSecret).update(query).digest("hex");
  }

  /** GET (public) — no auth, no signature. */
  async getPublic<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    const url = `${TESTNET_BASE}${path}${qs ? `?${qs}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** GET / POST / DELETE (signed) — adds timestamp + recvWindow + signature. */
  async signed<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const timestamp = Date.now();
    const merged: Record<string, string> = {
      recvWindow: "5000",
      timestamp: String(timestamp),
    };
    for (const [k, v] of Object.entries(params)) merged[k] = String(v);
    const qs = new URLSearchParams(merged).toString();
    const signature = this.sign(qs);
    const url = `${TESTNET_BASE}${path}?${qs}&signature=${signature}`;
    const res = await fetch(url, {
      method,
      headers: { "X-MBX-APIKEY": this.apiKey },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${body}`);
    return JSON.parse(body) as T;
  }
}

// ---------------------------------------------------------------------------
// BINANCE DATA → INTERNAL Candle TYPE
// ---------------------------------------------------------------------------

type BinanceKline = [
  number, // openTime
  string, // o
  string, // h
  string, // l
  string, // c
  string, // v
  number, // closeTime
  string, // quote volume
  number, // num trades
  string, // taker buy base
  string, // taker buy quote
  string, // ignore
];

function klineToCandle(k: BinanceKline): Candle {
  return {
    t: new Date(k[0]).toISOString(),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  };
}

async function fetchClosedCandles(
  client: BinanceTestnetClient,
  symbol: string,
  interval: Interval,
  limit: number,
): Promise<Candle[]> {
  const raw = await client.getPublic<BinanceKline[]>("/fapi/v1/klines", {
    symbol,
    interval,
    limit,
  });
  // Drop the still-forming current candle so generateSignals only sees CLOSED bars.
  const now = Date.now();
  const closed = raw.filter((k) => k[6] <= now);
  return closed.map(klineToCandle);
}

// ---------------------------------------------------------------------------
// EXCHANGE INFO — get tick / step / minNotional for the symbol
// ---------------------------------------------------------------------------

type ExchangeFilter = { filterType: string; [k: string]: unknown };
type ExchangeSymbol = {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
  filters: ExchangeFilter[];
};

type SymbolMeta = {
  pricePrecision: number;
  qtyPrecision: number;
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
};

async function loadSymbolMeta(client: BinanceTestnetClient, symbol: string): Promise<SymbolMeta> {
  const info = await client.getPublic<{ symbols: ExchangeSymbol[] }>("/fapi/v1/exchangeInfo");
  const s = info.symbols.find((x) => x.symbol === symbol);
  if (!s) throw new Error(`Symbol ${symbol} not found on testnet exchangeInfo`);

  const find = (t: string) => s.filters.find((f) => f.filterType === t) ?? {};
  const tickSize = Number((find("PRICE_FILTER") as { tickSize?: string }).tickSize ?? "0.1");
  const stepSize = Number((find("LOT_SIZE") as { stepSize?: string }).stepSize ?? "0.001");
  const minQty = Number((find("LOT_SIZE") as { minQty?: string }).minQty ?? "0.001");
  const minNotional = Number(
    (find("MIN_NOTIONAL") as { notional?: string }).notional ?? "5",
  );
  return {
    pricePrecision: s.pricePrecision,
    qtyPrecision: s.quantityPrecision,
    tickSize,
    stepSize,
    minQty,
    minNotional,
  };
}

function roundToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}
function roundToTick(value: number, tick: number): number {
  return Math.round(value / tick) * tick;
}
function fmt(n: number, precision: number): string {
  return n.toFixed(precision);
}

// ---------------------------------------------------------------------------
// POSITION & ORDER STATE READERS
// ---------------------------------------------------------------------------

type PositionInfo = {
  positionAmt: number; // signed, BTC. + = long, - = short, 0 = flat
  entryPrice: number;
  unrealizedProfit: number;
};

async function getPosition(
  client: BinanceTestnetClient,
  symbol: string,
): Promise<PositionInfo> {
  const arr = await client.signed<
    Array<{ symbol: string; positionAmt: string; entryPrice: string; unRealizedProfit: string }>
  >("GET", "/fapi/v2/positionRisk", { symbol });
  const p = arr.find((x) => x.symbol === symbol);
  if (!p) return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  return {
    positionAmt: Number(p.positionAmt),
    entryPrice: Number(p.entryPrice),
    unrealizedProfit: Number(p.unRealizedProfit),
  };
}

async function getBalanceUsdt(client: BinanceTestnetClient): Promise<number> {
  const arr = await client.signed<Array<{ asset: string; balance: string }>>(
    "GET",
    "/fapi/v2/balance",
  );
  const u = arr.find((x) => x.asset === "USDT");
  return u ? Number(u.balance) : 0;
}

async function cancelAllOpenOrders(
  client: BinanceTestnetClient,
  symbol: string,
): Promise<void> {
  try {
    await client.signed("DELETE", "/fapi/v1/allOpenOrders", { symbol });
  } catch (e) {
    warn("cancelAllOpenOrders:", (e as Error).message);
  }
}

async function setLeverage(
  client: BinanceTestnetClient,
  symbol: string,
  leverage: number,
): Promise<void> {
  await client.signed("POST", "/fapi/v1/leverage", { symbol, leverage });
}

// ---------------------------------------------------------------------------
// ORDER PLACEMENT
// ---------------------------------------------------------------------------

async function placeMarketEntry(
  client: BinanceTestnetClient,
  symbol: string,
  side: "BUY" | "SELL",
  qty: number,
  meta: SymbolMeta,
): Promise<unknown> {
  return client.signed("POST", "/fapi/v1/order", {
    symbol,
    side,
    type: "MARKET",
    quantity: fmt(qty, meta.qtyPrecision),
  });
}

async function placeStopAndTp(
  client: BinanceTestnetClient,
  symbol: string,
  side: "BUY" | "SELL",
  stopPrice: number,
  tpPrice: number,
  meta: SymbolMeta,
): Promise<void> {
  // For an exit on a LONG (side=BUY entry), SL/TP are SELL closePosition orders.
  // For a SHORT (side=SELL entry), SL/TP are BUY closePosition orders.
  const exitSide = side === "BUY" ? "SELL" : "BUY";
  const sp = fmt(roundToTick(stopPrice, meta.tickSize), meta.pricePrecision);
  const tp = fmt(roundToTick(tpPrice, meta.tickSize), meta.pricePrecision);

  await client.signed("POST", "/fapi/v1/order", {
    symbol,
    side: exitSide,
    type: "STOP_MARKET",
    stopPrice: sp,
    closePosition: "true",
    workingType: "MARK_PRICE",
    timeInForce: "GTE_GTC",
  });
  await client.signed("POST", "/fapi/v1/order", {
    symbol,
    side: exitSide,
    type: "TAKE_PROFIT_MARKET",
    stopPrice: tp,
    closePosition: "true",
    workingType: "MARK_PRICE",
    timeInForce: "GTE_GTC",
  });
}

async function closePositionMarket(
  client: BinanceTestnetClient,
  symbol: string,
  positionAmt: number,
  meta: SymbolMeta,
): Promise<void> {
  if (positionAmt === 0) return;
  const side = positionAmt > 0 ? "SELL" : "BUY";
  const qty = Math.abs(positionAmt);
  await client.signed("POST", "/fapi/v1/order", {
    symbol,
    side,
    type: "MARKET",
    quantity: fmt(roundToStep(qty, meta.stepSize), meta.qtyPrecision),
    reduceOnly: "true",
  });
}

// ---------------------------------------------------------------------------
// MAIN BOT LOOP
// ---------------------------------------------------------------------------

async function runOnce(
  cfg: CliConfig,
  client: BinanceTestnetClient,
  meta: SymbolMeta,
  lastActedCandleTime: { value: string },
): Promise<void> {
  const strategy = getStrategy(cfg.strategyId);
  if (!strategy) {
    err(`Unknown strategy id: ${cfg.strategyId}`);
    err(`Available: ${STRATEGIES.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }
  if (strategy.available === false) {
    err(`Strategy ${strategy.id} is unavailable: ${strategy.unavailableReason ?? "n/a"}`);
    process.exit(1);
  }

  // 1. Pull latest closed candles (need enough warmup for ATR + strategy).
  const candles = await fetchClosedCandles(client, cfg.symbol, cfg.interval, 500);
  if (candles.length < ATR_PERIOD + 10) {
    warn(`Not enough candles yet (${candles.length}); waiting…`);
    return;
  }
  const last = candles[candles.length - 1]!;

  // 2. Skip if we've already acted on this same closed candle.
  if (last.t === lastActedCandleTime.value) return;

  // 3. Generate signals USING THE EXACT SAME CODE AS THE BACKTEST.
  //    Pass empty params object — fractal_breakout has no params; other strategies
  //    will fall back to their `default` values via undefined-safe access in their code.
  const params: Record<string, number> = {};
  for (const p of strategy.params) params[p.key] = p.default;
  const signals = strategy.generateSignals(candles, params);
  const latestSignal: Signal = signals[signals.length - 1] ?? 0;

  // 4. ATR for SL/TP — same helper the backtest uses.
  const atrSeries = atr(highsArr(candles), lowsArr(candles), closesArr(candles), ATR_PERIOD);
  const atrVal = atrSeries[atrSeries.length - 1] ?? 0;
  if (atrVal <= 0) {
    warn(`ATR=${atrVal}; skipping`);
    return;
  }

  // 5. Read live state.
  const pos = await getPosition(client, cfg.symbol);
  const currentPos: Signal =
    pos.positionAmt > 0 ? 1 : pos.positionAmt < 0 ? -1 : 0;

  log(
    `candle=${last.t}  close=$${last.c.toFixed(2)}  atr=${atrVal.toFixed(2)}  ` +
      `signal=${latestSignal}  position=${currentPos} (${pos.positionAmt} BTC, entry $${pos.entryPrice.toFixed(2)}, uPnL $${pos.unrealizedProfit.toFixed(2)})`,
  );

  // 6. If flat with leftover SL/TP orders, sweep them.
  if (currentPos === 0) {
    await cancelAllOpenOrders(client, cfg.symbol);
  }

  // 7. Decide. Match backtest logic:
  //   - signal != position → close current then re-open in signal direction (or just stay flat if signal==0)
  //   - signal == position → hold (SL/TP do their job)
  if (latestSignal === currentPos) {
    lastActedCandleTime.value = last.t;
    log("hold (signal matches position)");
    return;
  }

  if (cfg.dryRun) {
    log(
      `DRY RUN: would close pos=${currentPos} and open new=${latestSignal} ` +
        `with SL=${(latestSignal === 1 ? last.c - atrVal * ATR_MULT_SL : last.c + atrVal * ATR_MULT_SL).toFixed(2)} ` +
        `TP=${(latestSignal === 1 ? last.c + atrVal * ATR_MULT_SL * RR_RATIO : last.c - atrVal * ATR_MULT_SL * RR_RATIO).toFixed(2)}`,
    );
    lastActedCandleTime.value = last.t;
    return;
  }

  // 7a. Close existing position if any.
  if (currentPos !== 0) {
    log(`closing existing ${currentPos > 0 ? "LONG" : "SHORT"} (${pos.positionAmt} BTC)…`);
    await cancelAllOpenOrders(client, cfg.symbol);
    await closePositionMarket(client, cfg.symbol, pos.positionAmt, meta);
  }

  // 7b. Open new position if signal != 0.
  if (latestSignal !== 0) {
    const side: "BUY" | "SELL" = latestSignal === 1 ? "BUY" : "SELL";
    const notionalUsdt = cfg.capital * (cfg.riskPct / 100) * cfg.leverage;
    const rawQty = notionalUsdt / last.c;
    const qty = roundToStep(rawQty, meta.stepSize);
    const trueNotional = qty * last.c;

    if (qty < meta.minQty) {
      warn(
        `qty ${qty} < minQty ${meta.minQty}. Increase capital/risk/leverage. ` +
          `Need notional ≥ $${(meta.minQty * last.c).toFixed(2)}.`,
      );
      lastActedCandleTime.value = last.t;
      return;
    }
    if (trueNotional < meta.minNotional) {
      warn(
        `notional $${trueNotional.toFixed(2)} < minNotional $${meta.minNotional}. ` +
          `Skipping order. Increase capital/risk/leverage.`,
      );
      lastActedCandleTime.value = last.t;
      return;
    }

    const slDist = atrVal * ATR_MULT_SL;
    const tpDist = slDist * RR_RATIO;
    const stopPrice = side === "BUY" ? last.c - slDist : last.c + slDist;
    const tpPrice = side === "BUY" ? last.c + tpDist : last.c - tpDist;

    log(
      `opening ${side} qty=${qty} notional≈$${trueNotional.toFixed(2)} ` +
        `SL=$${stopPrice.toFixed(2)} TP=$${tpPrice.toFixed(2)}…`,
    );

    await placeMarketEntry(client, cfg.symbol, side, qty, meta);
    // Wait briefly for the position to register before posting closePosition orders.
    await sleep(500);
    await placeStopAndTp(client, cfg.symbol, side, stopPrice, tpPrice, meta);

    log(`✓ entered ${side} ${qty} ${cfg.symbol}`);
  } else {
    log("flat → flat (signal=0); position closed, no re-entry");
  }

  lastActedCandleTime.value = last.t;
}

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));

  log("─────────────────────────────────────────────────────");
  log(`Strategy Lab LIVE BOT  ·  Binance Futures TESTNET`);
  log("─────────────────────────────────────────────────────");
  log(`Strategy:    ${cfg.strategyId}`);
  log(`Symbol:      ${cfg.symbol}`);
  log(`Interval:    ${cfg.interval}`);
  log(`Leverage:    ${cfg.leverage}x`);
  log(`Risk/trade:  ${cfg.riskPct}%`);
  log(`Capital:     $${cfg.capital} USDT (sizing basis)`);
  log(`Mode:        ${cfg.dryRun ? "DRY-RUN (no orders)" : "LIVE on TESTNET"}`);
  log("─────────────────────────────────────────────────────");

  const apiKey = process.env.BINANCE_TESTNET_API_KEY;
  const apiSecret = process.env.BINANCE_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    err(
      "Missing BINANCE_TESTNET_API_KEY or BINANCE_TESTNET_API_SECRET. " +
        "Get them from https://testnet.binancefuture.com → API Keys, then add via Replit Secrets.",
    );
    process.exit(1);
  }

  const client = new BinanceTestnetClient(apiKey, apiSecret);

  // Load exchange filters for the symbol.
  const meta = await loadSymbolMeta(client, cfg.symbol);
  log(
    `exchangeInfo: tick=${meta.tickSize} step=${meta.stepSize} ` +
      `minQty=${meta.minQty} minNotional=$${meta.minNotional} ` +
      `pricePrec=${meta.pricePrecision} qtyPrec=${meta.qtyPrecision}`,
  );

  // Set leverage (idempotent).
  if (!cfg.dryRun) {
    try {
      await setLeverage(client, cfg.symbol, cfg.leverage);
      log(`leverage set to ${cfg.leverage}x`);
    } catch (e) {
      warn(`could not set leverage: ${(e as Error).message}`);
    }
  }

  // Show balance.
  try {
    const usdt = await getBalanceUsdt(client);
    log(`testnet USDT balance: $${usdt.toFixed(2)}`);
  } catch (e) {
    warn(`could not read balance: ${(e as Error).message}`);
  }

  const lastActedCandleTime = { value: "" };

  if (cfg.once) {
    await runOnce(cfg, client, meta, lastActedCandleTime);
    return;
  }

  log(`polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl+C to stop.`);

  // Main loop. Each tick we pull klines and only act when the latest CLOSED
  // candle's timestamp differs from the one we last acted on.
  while (true) {
    try {
      await runOnce(cfg, client, meta, lastActedCandleTime);
    } catch (e) {
      err(`tick error: ${(e as Error).message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  err(`fatal: ${(e as Error).stack ?? (e as Error).message}`);
  process.exit(1);
});
