import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { getStrategy, atr, highsArr, lowsArr, closesArr } from "../lib/strategies";
import type { Candle, Interval } from "../types/strategy";
import { INTERVAL_MS } from "../types/strategy";

const router: IRouter = Router();

const TESTNET_BASE = "https://testnet.binancefuture.com";
const STRATEGY_ID = "fractal_breakout";
const INTERVAL: Interval = "1h";
const ATR_PERIOD = 14;

function sign(secret: string, query: string): string {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

async function binancePublic<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`${TESTNET_BASE}${path}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

async function binanceSigned<T>(key: string, secret: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const merged: Record<string, string> = { recvWindow: "5000", timestamp: String(Date.now()) };
  for (const [k, v] of Object.entries(params)) merged[k] = String(v);
  const qs = new URLSearchParams(merged).toString();
  const sig = sign(secret, qs);
  const res = await fetch(`${TESTNET_BASE}${path}?${qs}&signature=${sig}`, {
    headers: { "X-MBX-APIKEY": key },
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

function toCandle(k: BinanceKline): Candle {
  return { t: new Date(k[0]).toISOString(), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) };
}

router.get("/bot/status", async (req, res, next) => {
  try {
    const apiKey = process.env.BINANCE_TESTNET_API_KEY;
    const apiSecret = process.env.BINANCE_TESTNET_API_SECRET;

    if (!apiKey || !apiSecret) {
      res.json({ connected: false, reason: "API keys not configured" });
      return;
    }

    const intervalMs = INTERVAL_MS[INTERVAL];

    // Parallel: klines (public) + markPrice (public) + position+balance (signed)
    const [rawKlines, markData, posArr, balArr] = await Promise.all([
      binancePublic<BinanceKline[]>("/fapi/v1/klines", { symbol: "BTCUSDT", interval: INTERVAL, limit: 200 }),
      binancePublic<{ markPrice: string; time: number }>("/fapi/v1/premiumIndex", { symbol: "BTCUSDT" }),
      binanceSigned<Array<{ symbol: string; positionAmt: string; entryPrice: string; unRealizedProfit: string }>>(
        apiKey, apiSecret, "/fapi/v2/positionRisk", { symbol: "BTCUSDT" },
      ),
      binanceSigned<Array<{ asset: string; balance: string; availableBalance: string }>>(
        apiKey, apiSecret, "/fapi/v2/balance",
      ),
    ]);

    // Closed candles only
    const now = Date.now();
    const candles = rawKlines.filter((k) => k[6] <= now).map(toCandle);
    const last = candles[candles.length - 1];

    // Signal
    const strategy = getStrategy(STRATEGY_ID)!;
    const params: Record<string, number> = {};
    for (const p of strategy.params) params[p.key] = p.default;
    const signals = strategy.generateSignals(candles, params);
    const signal = signals[signals.length - 1] ?? 0;

    // ATR
    const atrSeries = atr(highsArr(candles), lowsArr(candles), closesArr(candles), ATR_PERIOD);
    const atrVal = atrSeries[atrSeries.length - 1] ?? 0;

    // Position
    const pos = posArr.find((p) => p.symbol === "BTCUSDT");
    const posAmt = pos ? Number(pos.positionAmt) : 0;
    const entryPrice = pos ? Number(pos.entryPrice) : 0;
    const unrealizedPnl = pos ? Number(pos.unRealizedProfit) : 0;

    // Balance
    const usdtBal = balArr.find((b) => b.asset === "USDT");
    const balance = usdtBal ? Number(usdtBal.balance) : 0;
    const availableBalance = usdtBal ? Number(usdtBal.availableBalance) : 0;

    // Next candle close
    const lastCandleOpenMs = last ? new Date(last.t).getTime() : 0;
    const nextCandleCloseMs = lastCandleOpenMs + intervalMs * 2 - 1; // next candle closes at openMs + 2*interval - 1ms

    // SL/TP levels if signal != 0
    const slDist = atrVal * 1.5;
    const tpDist = slDist * 2;
    const sl = signal === 1 ? (last?.c ?? 0) - slDist : signal === -1 ? (last?.c ?? 0) + slDist : null;
    const tp = signal === 1 ? (last?.c ?? 0) + tpDist : signal === -1 ? (last?.c ?? 0) - tpDist : null;

    res.json({
      connected: true,
      ts: now,
      symbol: "BTCUSDT",
      markPrice: Number(markData.markPrice),
      balance,
      availableBalance,
      position: {
        amt: posAmt,
        side: posAmt > 0 ? "LONG" : posAmt < 0 ? "SHORT" : "FLAT",
        entryPrice,
        unrealizedPnl,
      },
      signal,
      atr: atrVal,
      sl,
      tp,
      lastCandle: last ? { time: last.t, close: last.c } : null,
      nextCandleCloseMs,
      config: {
        strategyId: STRATEGY_ID,
        strategyName: strategy.name,
        interval: INTERVAL,
        leverage: 20,
        riskPct: 10,
        capital: 100,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
