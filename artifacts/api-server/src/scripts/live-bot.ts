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
 * SL/TP are enforced in SOFTWARE — the bot checks mark price every 5 seconds
 * and closes with a market order when price crosses SL or TP. This avoids
 * Binance Testnet's -4120 rejection of conditional order types.
 *
 * Every trade open/close is appended to trade-history.json in the api-server
 * directory so the Live Bot UI panel can display history across restarts.
 *
 * USAGE:
 *   pnpm --filter @workspace/api-server run live -- [flags]
 *
 * FLAGS:
 *   --strategy=<id>       strategy id (default: fractal_breakout — tournament #1)
 *   --interval=<tf>       candle timeframe: 5m|15m|30m|1h|2h|4h|1d (default: 1h)
 *   --leverage=<n>        leverage 1..125 (default: 20)
 *   --risk=<pct>          risk per trade % of capital (default: 10)
 *   --capital=<usdt>      notional sizing basis in USDT (default: 100)
 *   --symbol=<sym>        trading pair (default: BTCUSDT)
 *   --dry-run             log actions without placing real orders
 *   --once                evaluate once and exit (useful for testing)
 *   --force-signal=<n>    override strategy signal: 1=long, -1=short, 0=flat (testing)
 *
 * REQUIRED ENV:
 *   BINANCE_TESTNET_API_KEY    — from https://testnet.binancefuture.com → API Keys
 *   BINANCE_TESTNET_API_SECRET — same place
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
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
// CONFIG — mirrors DEFAULT_RISK in LabControls.tsx (intentionally duplicated)
// ---------------------------------------------------------------------------

const TESTNET_BASE = "https://testnet.binancefuture.com";
const ATR_PERIOD = 14;
const ATR_MULT_SL = 1.5;
const RR_RATIO = 2;
const POLL_INTERVAL_MS = 5_000;

// Trade history file — shared with the API server route /api/bot/trades.
const TRADES_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../trade-history.json",
);

// ---------------------------------------------------------------------------
// TRADE HISTORY (persisted to file so UI shows history across restarts)
// ---------------------------------------------------------------------------

export type TradeRecord = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  entryTime: string;
  entryPrice: number;
  sl: number;
  tp: number;
  exitTime?: string;
  exitPrice?: number;
  exitReason?: "SL" | "TP" | "signal_exit";
  pnl?: number;
  status: "open" | "closed";
};

function loadTrades(): TradeRecord[] {
  try {
    return JSON.parse(fs.readFileSync(TRADES_FILE, "utf-8")) as TradeRecord[];
  } catch {
    return [];
  }
}

function saveTrades(trades: TradeRecord[]): void {
  try {
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
  } catch (e) {
    warn(`could not save trades: ${(e as Error).message}`);
  }
}

function recordOpen(
  symbol: string,
  side: "BUY" | "SELL",
  qty: number,
  entryPrice: number,
  sl: number,
  tp: number,
): string {
  const trades = loadTrades();
  // Close any stale open records (shouldn't happen, but safety net).
  for (const t of trades) {
    if (t.status === "open") {
      t.status = "closed";
      t.exitReason = "signal_exit";
      t.exitTime = new Date().toISOString();
    }
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  trades.push({ id, symbol, side, qty, entryTime: new Date().toISOString(), entryPrice, sl, tp, status: "open" });
  saveTrades(trades);
  return id;
}

function recordClose(
  tradeId: string,
  exitPrice: number,
  exitReason: "SL" | "TP" | "signal_exit",
): void {
  const trades = loadTrades();
  const t = trades.find((x) => x.id === tradeId);
  if (!t) return;
  const priceDiff = t.side === "BUY" ? exitPrice - t.entryPrice : t.entryPrice - exitPrice;
  const pnl = priceDiff * t.qty;
  Object.assign(t, {
    exitTime: new Date().toISOString(),
    exitPrice,
    exitReason,
    pnl,
    status: "closed",
  });
  saveTrades(trades);
  log(`📒 trade recorded: ${t.side} ${t.qty} BTC  entry=$${t.entryPrice.toFixed(2)}  exit=$${exitPrice.toFixed(2)}  pnl=${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)}  reason=${exitReason}`);
}

// ---------------------------------------------------------------------------
// CLI ARGS
// ---------------------------------------------------------------------------

type CliConfig = {
  strategyId: string;
  interval: Interval;
  leverage: number;
  riskPct: number;
  capital: number;
  symbol: string;
  dryRun: boolean;
  once: boolean;
  forceSignal: Signal | null;
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
  let forceSignal: Signal | null = null;
  if (flags["force-signal"] !== undefined) {
    const v = Number(flags["force-signal"]);
    if (v === 1 || v === -1 || v === 0) forceSignal = v as Signal;
    else throw new Error(`--force-signal must be 1, -1, or 0`);
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
    forceSignal,
  };
}

// ---------------------------------------------------------------------------
// LOGGING
// ---------------------------------------------------------------------------

function ts(): string { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function log(...args: unknown[]): void { console.log(`[${ts()}]`, ...args); }
function warn(...args: unknown[]): void { console.warn(`[${ts()}] ⚠`, ...args); }
function err(...args: unknown[]): void { console.error(`[${ts()}] ✗`, ...args); }

// ---------------------------------------------------------------------------
// TELEGRAM NOTIFICATIONS — silent if env vars not set, never crashes bot
// ---------------------------------------------------------------------------
async function sendTelegram(msg: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML" }),
    });
  } catch { /* never crash the bot for a notification */ }
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

  async getPublic<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const url = `${TESTNET_BASE}${path}${qs ? `?${qs}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async signed<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const merged: Record<string, string> = { recvWindow: "5000", timestamp: String(Date.now()) };
    for (const [k, v] of Object.entries(params)) merged[k] = String(v);
    const qs = new URLSearchParams(merged).toString();
    const signature = this.sign(qs);
    const url = `${TESTNET_BASE}${path}?${qs}&signature=${signature}`;
    const res = await fetch(url, { method, headers: { "X-MBX-APIKEY": this.apiKey } });
    const body = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${body}`);
    return JSON.parse(body) as T;
  }
}

// ---------------------------------------------------------------------------
// CANDLES
// ---------------------------------------------------------------------------

type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

function klineToCandle(k: BinanceKline): Candle {
  return { t: new Date(k[0]).toISOString(), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) };
}

async function fetchClosedCandles(
  client: BinanceTestnetClient,
  symbol: string,
  interval: Interval,
  limit: number,
): Promise<Candle[]> {
  const raw = await client.getPublic<BinanceKline[]>("/fapi/v1/klines", { symbol, interval, limit });
  const now = Date.now();
  return raw.filter((k) => k[6] <= now).map(klineToCandle);
}

// ---------------------------------------------------------------------------
// MARK PRICE
// ---------------------------------------------------------------------------

async function getMarkPrice(client: BinanceTestnetClient, symbol: string): Promise<number> {
  const r = await client.getPublic<{ markPrice: string }>("/fapi/v1/premiumIndex", { symbol });
  return Number(r.markPrice);
}

// ---------------------------------------------------------------------------
// EXCHANGE INFO
// ---------------------------------------------------------------------------

type ExchangeFilter = { filterType: string; [k: string]: unknown };
type ExchangeSymbol = { symbol: string; pricePrecision: number; quantityPrecision: number; filters: ExchangeFilter[] };
type SymbolMeta = { pricePrecision: number; qtyPrecision: number; tickSize: number; stepSize: number; minQty: number; minNotional: number };

async function loadSymbolMeta(client: BinanceTestnetClient, symbol: string): Promise<SymbolMeta> {
  const info = await client.getPublic<{ symbols: ExchangeSymbol[] }>("/fapi/v1/exchangeInfo");
  const s = info.symbols.find((x) => x.symbol === symbol);
  if (!s) throw new Error(`Symbol ${symbol} not found`);
  const find = (t: string) => s.filters.find((f) => f.filterType === t) ?? {};
  return {
    pricePrecision: s.pricePrecision,
    qtyPrecision: s.quantityPrecision,
    tickSize: Number((find("PRICE_FILTER") as { tickSize?: string }).tickSize ?? "0.1"),
    stepSize: Number((find("LOT_SIZE") as { stepSize?: string }).stepSize ?? "0.001"),
    minQty: Number((find("LOT_SIZE") as { minQty?: string }).minQty ?? "0.001"),
    minNotional: Number((find("MIN_NOTIONAL") as { notional?: string }).notional ?? "5"),
  };
}

function roundToStep(v: number, step: number): number { return Math.floor(v / step) * step; }
function fmt(n: number, p: number): string { return n.toFixed(p); }

// ---------------------------------------------------------------------------
// POSITION / BALANCE
// ---------------------------------------------------------------------------

type PositionInfo = { positionAmt: number; entryPrice: number; unrealizedProfit: number };

async function getPosition(client: BinanceTestnetClient, symbol: string): Promise<PositionInfo> {
  const arr = await client.signed<Array<{ symbol: string; positionAmt: string; entryPrice: string; unRealizedProfit: string }>>(
    "GET", "/fapi/v2/positionRisk", { symbol },
  );
  const p = arr.find((x) => x.symbol === symbol);
  if (!p) return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  return { positionAmt: Number(p.positionAmt), entryPrice: Number(p.entryPrice), unrealizedProfit: Number(p.unRealizedProfit) };
}

async function getBalanceUsdt(client: BinanceTestnetClient): Promise<number> {
  const arr = await client.signed<Array<{ asset: string; balance: string }>>("GET", "/fapi/v2/balance");
  const u = arr.find((x) => x.asset === "USDT");
  return u ? Number(u.balance) : 0;
}

async function setLeverage(client: BinanceTestnetClient, symbol: string, leverage: number): Promise<void> {
  await client.signed("POST", "/fapi/v1/leverage", { symbol, leverage });
}

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------

async function placeMarketOrder(
  client: BinanceTestnetClient,
  symbol: string,
  side: "BUY" | "SELL",
  qty: number,
  meta: SymbolMeta,
  reduceOnly = false,
): Promise<void> {
  const params: Record<string, string | number | boolean> = {
    symbol, side, type: "MARKET", quantity: fmt(qty, meta.qtyPrecision),
  };
  if (reduceOnly) params.reduceOnly = "true";
  await client.signed("POST", "/fapi/v1/order", params);
}

// ---------------------------------------------------------------------------
// SOFTWARE SL/TP STATE
// ---------------------------------------------------------------------------

type SoftTrade = {
  id: string;       // links to TradeRecord for history logging
  side: "BUY" | "SELL";
  qty: number;
  sl: number;
  tp: number;
  entryPrice: number;
};

// ---------------------------------------------------------------------------
// MAIN TICK
// ---------------------------------------------------------------------------

async function runTick(
  cfg: CliConfig,
  client: BinanceTestnetClient,
  meta: SymbolMeta,
  state: {
    lastActedCandleTime: string;
    softTrade: SoftTrade | null;
    strategy: ReturnType<typeof getStrategy>;
    params: Record<string, number>;
  },
): Promise<void> {
  const { strategy, params } = state;
  if (!strategy) return;

  // 1. Fetch mark price + position first (for software SL/TP check).
  const [markPrice, pos] = await Promise.all([
    getMarkPrice(client, cfg.symbol),
    getPosition(client, cfg.symbol),
  ]);
  const currentPosAmt = pos.positionAmt;
  const currentPos: Signal = currentPosAmt > 0 ? 1 : currentPosAmt < 0 ? -1 : 0;

  // 2. Software SL/TP — checked every 5s regardless of candle close.
  if (state.softTrade && currentPos !== 0) {
    const { sl, tp, side, qty, id } = state.softTrade;
    const hitSl = side === "BUY" ? markPrice <= sl : markPrice >= sl;
    const hitTp = side === "BUY" ? markPrice >= tp : markPrice <= tp;

    if (hitSl || hitTp) {
      const exitReason: "SL" | "TP" = hitSl ? "SL" : "TP";
      const reason = hitSl
        ? `SL hit @ $${markPrice.toFixed(2)} (limit $${sl.toFixed(2)})`
        : `TP hit @ $${markPrice.toFixed(2)} (target $${tp.toFixed(2)})`;
      log(`🛑 ${reason} — closing ${side} position (${qty} BTC)…`);
      if (!cfg.dryRun) {
        const exitSide: "BUY" | "SELL" = side === "BUY" ? "SELL" : "BUY";
        await placeMarketOrder(client, cfg.symbol, exitSide, qty, meta, true);
        recordClose(id, markPrice, exitReason);
      }
      state.softTrade = null;
      log(`✓ position closed via software ${exitReason}`);
      const pnlEst = side === "BUY"
        ? (markPrice - sl) * qty * (exitReason === "TP" ? RR_RATIO : -1)
        : (sl - markPrice) * qty * (exitReason === "TP" ? RR_RATIO : -1);
      await sendTelegram(
        `${exitReason === "TP" ? "✅" : "❌"} <b>${side === "BUY" ? "LONG" : "SHORT"} DITUTUP — ${exitReason === "TP" ? "PROFIT" : "STOP LOSS"}</b>\n` +
        `Pair: <b>${cfg.symbol}</b>\n` +
        `Exit: <b>$${markPrice.toFixed(2)}</b>\n` +
        `${exitReason === "TP" ? "TP" : "SL"} tercapai @ $${(exitReason === "TP" ? tp : sl).toFixed(2)}\n` +
        `Est. PnL: ${pnlEst >= 0 ? "+" : ""}$${pnlEst.toFixed(2)}`
      );
      return;
    }

    log(
      `mark=$${markPrice.toFixed(2)}  pos=${currentPos > 0 ? "LONG" : "SHORT"} ${qty}BTC ` +
      `entry=$${pos.entryPrice.toFixed(2)} uPnL=$${pos.unrealizedProfit.toFixed(2)} ` +
      `SL=$${sl.toFixed(2)} TP=$${tp.toFixed(2)}`,
    );
  }

  // 3. Fetch latest closed candles for signal generation.
  const candles = await fetchClosedCandles(client, cfg.symbol, cfg.interval, 500);
  if (candles.length < ATR_PERIOD + 10) { warn("Not enough candles yet; waiting…"); return; }
  const last = candles[candles.length - 1]!;

  // 4. Only act on NEW closed candle.
  if (last.t === state.lastActedCandleTime && state.softTrade) return;

  // 5. Generate strategy signal — identical to the backtest engine.
  const signals = strategy.generateSignals(candles, params);
  const strategySignal: Signal = signals[signals.length - 1] ?? 0;
  const latestSignal: Signal =
    cfg.forceSignal !== null
      ? (log(`⚡ force-signal override: strategy=${strategySignal} → forced=${cfg.forceSignal}`), cfg.forceSignal)
      : strategySignal;

  // 6. ATR for SL/TP sizing.
  const atrSeries = atr(highsArr(candles), lowsArr(candles), closesArr(candles), ATR_PERIOD);
  const atrVal = atrSeries[atrSeries.length - 1] ?? 0;
  if (atrVal <= 0) { warn(`ATR=${atrVal}; skipping`); return; }

  log(
    `candle=${last.t}  close=$${last.c.toFixed(2)}  atr=${atrVal.toFixed(2)}  ` +
    `signal=${latestSignal}  position=${currentPos} (${currentPosAmt} BTC, uPnL $${pos.unrealizedProfit.toFixed(2)})`,
  );

  // 7. If flat but softTrade still set, position was closed externally.
  if (currentPos === 0 && state.softTrade) {
    log("position closed externally — clearing softTrade state");
    state.softTrade = null;
  }

  // 8. Already acted on this candle → skip.
  if (last.t === state.lastActedCandleTime) {
    log("hold (already acted on this candle)");
    return;
  }

  // 9. Signal unchanged → hold.
  if (latestSignal === currentPos) {
    state.lastActedCandleTime = last.t;
    log("hold (signal matches position)");
    return;
  }

  if (cfg.dryRun) {
    const slDist = atrVal * ATR_MULT_SL;
    log(
      `DRY RUN: close pos=${currentPos}, open new=${latestSignal} ` +
      `SL≈$${(latestSignal === 1 ? last.c - slDist : last.c + slDist).toFixed(2)} ` +
      `TP≈$${(latestSignal === 1 ? last.c + slDist * RR_RATIO : last.c - slDist * RR_RATIO).toFixed(2)}`,
    );
    state.lastActedCandleTime = last.t;
    return;
  }

  // 10. Close existing position if any.
  if (currentPos !== 0) {
    log(`closing existing ${currentPos > 0 ? "LONG" : "SHORT"} (${currentPosAmt} BTC)…`);
    const exitSide: "BUY" | "SELL" = currentPosAmt > 0 ? "SELL" : "BUY";
    await placeMarketOrder(client, cfg.symbol, exitSide, Math.abs(currentPosAmt), meta, true);
    if (state.softTrade) {
      recordClose(state.softTrade.id, markPrice, "signal_exit");
      await sendTelegram(
        `🔄 <b>${state.softTrade.side === "BUY" ? "LONG" : "SHORT"} DITUTUP — SIGNAL BALIK</b>\n` +
        `Pair: <b>${cfg.symbol}</b>\n` +
        `Exit: <b>$${markPrice.toFixed(2)}</b>\n` +
        `Entry: $${state.softTrade.entryPrice.toFixed(2)}`
      );
    }
    state.softTrade = null;
    await sleep(600);
  }

  // 11. Open new position if signal != 0.
  if (latestSignal !== 0) {
    const side: "BUY" | "SELL" = latestSignal === 1 ? "BUY" : "SELL";
    const notionalUsdt = cfg.capital * (cfg.riskPct / 100) * cfg.leverage;
    const rawQty = notionalUsdt / last.c;
    const qty = roundToStep(rawQty, meta.stepSize);
    const trueNotional = qty * last.c;

    if (qty < meta.minQty) {
      warn(`qty ${qty} < minQty ${meta.minQty}.`);
      state.lastActedCandleTime = last.t;
      return;
    }
    if (trueNotional < meta.minNotional) {
      warn(`notional $${trueNotional.toFixed(2)} < minNotional $${meta.minNotional}.`);
      state.lastActedCandleTime = last.t;
      return;
    }

    const slDist = atrVal * ATR_MULT_SL;
    const tpDist = slDist * RR_RATIO;
    const sl = side === "BUY" ? last.c - slDist : last.c + slDist;
    const tp = side === "BUY" ? last.c + tpDist : last.c - tpDist;

    log(`opening ${side} ${qty} BTC  notional≈$${trueNotional.toFixed(2)}  SL=$${sl.toFixed(2)}  TP=$${tp.toFixed(2)}…`);

    await placeMarketOrder(client, cfg.symbol, side, qty, meta, false);

    // Persist to trade history file.
    const tradeId = recordOpen(cfg.symbol, side, qty, last.c, sl, tp);

    state.softTrade = { id: tradeId, side, qty, sl, tp, entryPrice: last.c };

    log(`✓ entered ${side} ${qty} BTC  |  software SL=$${sl.toFixed(2)}  TP=$${tp.toFixed(2)}`);
    log(`  → bot will auto-close when mark price hits SL or TP (checked every ${POLL_INTERVAL_MS / 1000}s)`);
    await sendTelegram(
      `${side === "BUY" ? "🟢" : "🔴"} <b>${side === "BUY" ? "LONG" : "SHORT"} DIBUKA</b>\n` +
      `Pair: <b>${cfg.symbol}</b>\n` +
      `Harga entry: <b>$${last.c.toFixed(2)}</b>\n` +
      `SL: $${sl.toFixed(2)}  |  TP: $${tp.toFixed(2)}\n` +
      `Size: ${qty} BTC (~$${trueNotional.toFixed(0)})  |  ${cfg.leverage}x`
    );
  } else {
    log("flat → flat (signal=0); position closed, no re-entry");
  }

  state.lastActedCandleTime = last.t;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

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
  log(`SL/TP:       software-enforced (checked every ${POLL_INTERVAL_MS / 1000}s)`);
  log(`Trade log:   ${TRADES_FILE}`);
  log(`Mode:        ${cfg.dryRun ? "DRY-RUN (no orders)" : "LIVE on TESTNET"}`);
  log("─────────────────────────────────────────────────────");

  const apiKey = process.env.BINANCE_TESTNET_API_KEY;
  const apiSecret = process.env.BINANCE_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    err("Missing BINANCE_TESTNET_API_KEY or BINANCE_TESTNET_API_SECRET env vars.");
    process.exit(1);
  }

  const client = new BinanceTestnetClient(apiKey, apiSecret);

  const meta = await loadSymbolMeta(client, cfg.symbol);
  log(`exchangeInfo: tick=${meta.tickSize} step=${meta.stepSize} minQty=${meta.minQty} minNotional=$${meta.minNotional}`);

  if (!cfg.dryRun) {
    try { await setLeverage(client, cfg.symbol, cfg.leverage); log(`leverage set to ${cfg.leverage}x`); }
    catch (e) { warn(`could not set leverage: ${(e as Error).message}`); }
  }

  try { log(`testnet USDT balance: $${(await getBalanceUsdt(client)).toFixed(2)}`); }
  catch (e) { warn(`could not read balance: ${(e as Error).message}`); }

  const strategy = getStrategy(cfg.strategyId);
  if (!strategy) {
    err(`Unknown strategy: ${cfg.strategyId}. Available: ${STRATEGIES.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }
  if (strategy.available === false) {
    err(`Strategy ${strategy.id} unavailable: ${strategy.unavailableReason ?? "n/a"}`);
    process.exit(1);
  }

  const params: Record<string, number> = {};
  for (const p of strategy.params) params[p.key] = p.default;

  const state = {
    lastActedCandleTime: "",
    softTrade: null as SoftTrade | null,
    strategy,
    params,
  };

  if (cfg.once) {
    await runTick(cfg, client, meta, state);
    return;
  }

  log(`polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
  while (true) {
    try { await runTick(cfg, client, meta, state); }
    catch (e) { err(`tick error: ${(e as Error).message}`); }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  err(`fatal: ${(e as Error).stack ?? (e as Error).message}`);
  process.exit(1);
});
