import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getStrategy, atr, highsArr, lowsArr, closesArr } from "./strategies";
import type { Candle, Interval } from "../types/strategy";
import { INTERVAL_MS } from "../types/strategy";

const TRADES_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../trade-history.json",
);

const TESTNET_BASE = "https://testnet.binancefuture.com";
const STRATEGY_ID = "fractal_breakout";
const INTERVAL: Interval = "1h";
const ATR_PERIOD = 14;

type TradeRecord = {
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

type TgUpdate = {
  update_id: number;
  message?: { message_id: number; chat: { id: number }; text?: string };
};

type TgResponse<T> = { ok: boolean; result: T };

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  ? Number(process.env.TELEGRAM_CHAT_ID)
  : null;

async function tgPost<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as TgResponse<T>;
  return data.result;
}

async function tgGet<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}${qs ? `?${qs}` : ""}`);
  const data = (await res.json()) as TgResponse<T>;
  if (!data.ok) throw new Error(`Telegram ${method} gagal`);
  return data.result;
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await tgPost("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

function loadTrades(): TradeRecord[] {
  try { return JSON.parse(fs.readFileSync(TRADES_FILE, "utf-8")) as TradeRecord[]; }
  catch { return []; }
}

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

async function handleHistory(chatId: number, args: string[]): Promise<void> {
  const n = Math.min(20, Math.max(1, parseInt(args[0] ?? "5") || 5));
  const trades = loadTrades();

  if (trades.length === 0) {
    await sendMessage(chatId, "📭 Belum ada trade history.");
    return;
  }

  const recent = trades.slice(-n).reverse();
  const totalPnl = trades.filter((t) => t.pnl !== undefined).reduce((a, t) => a + (t.pnl ?? 0), 0);
  const wins = trades.filter((t) => t.exitReason === "TP").length;
  const losses = trades.filter((t) => t.exitReason === "SL").length;
  const closed = trades.filter((t) => t.status === "closed").length;
  const winRate = closed > 0 ? ((wins / closed) * 100).toFixed(1) : "0";

  let msg =
    `📊 <b>Trade History</b> (${n} terakhir dari ${trades.length} total)\n` +
    `───────────────────────\n` +
    `Total PnL: <b>${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}</b>\n` +
    `Win/Loss: ${wins}W / ${losses}L  |  Win Rate: ${winRate}%\n` +
    `Open: ${trades.filter((t) => t.status === "open").length}  |  Closed: ${closed}\n` +
    `───────────────────────\n\n`;

  for (let i = 0; i < recent.length; i++) {
    const t = recent[i]!;
    const side = t.side === "BUY" ? "🟢 LONG" : "🔴 SHORT";
    const status = t.status === "open" ? "🔵 OPEN" : t.exitReason === "TP" ? "✅ TP" : t.exitReason === "SL" ? "❌ SL" : "🔄 EXIT";
    msg +=
      `<b>#${i + 1} ${side} — ${status}</b>\n` +
      `Entry: <b>$${t.entryPrice.toFixed(2)}</b> @ ${formatTime(t.entryTime)}\n` +
      `SL: $${t.sl.toFixed(2)}  |  TP: $${t.tp.toFixed(2)}\n` +
      (t.exitPrice ? `Exit: $${t.exitPrice.toFixed(2)} @ ${formatTime(t.exitTime!)}\n` : "") +
      (t.pnl !== undefined ? `PnL: <b>${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}</b>\n` : "") +
      "\n";
  }

  await sendMessage(chatId, msg);
}

async function handleStatus(chatId: number): Promise<void> {
  const apiKey = process.env.BINANCE_TESTNET_API_KEY;
  const apiSecret = process.env.BINANCE_TESTNET_API_SECRET;

  if (!apiKey || !apiSecret) {
    const trades = loadTrades();
    const open = trades.find((t) => t.status === "open");
    let msg = `📡 <b>Status Bot</b>\n───────────────────────\n`;
    if (open) {
      const side = open.side === "BUY" ? "🟢 LONG" : "🔴 SHORT";
      msg += `Posisi: <b>${side}</b> ${open.qty} BTC\nEntry: $${open.entryPrice.toFixed(2)}\nSL: $${open.sl.toFixed(2)}  |  TP: $${open.tp.toFixed(2)}`;
    } else {
      msg += `Posisi: <b>⚪ FLAT</b>`;
    }
    msg += `\n\n<i>Binance API key tidak di-set, data dari trade log lokal.</i>`;
    await sendMessage(chatId, msg);
    return;
  }

  try {
    const sign = (qs: string) => crypto.createHmac("sha256", apiSecret).update(qs).digest("hex");
    const base = { recvWindow: "5000", timestamp: String(Date.now()) };
    const posQs = new URLSearchParams({ ...base, symbol: "BTCUSDT" }).toString();
    const balQs = new URLSearchParams({ ...base }).toString();

    type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];
    const [markRes, posRes, balRes, klineRes] = await Promise.all([
      fetch(`${TESTNET_BASE}/fapi/v1/premiumIndex?symbol=BTCUSDT`).then((r) => r.json()) as Promise<{ markPrice: string }>,
      fetch(`${TESTNET_BASE}/fapi/v2/positionRisk?${posQs}&signature=${sign(posQs)}`, { headers: { "X-MBX-APIKEY": apiKey } }).then((r) => r.json()) as Promise<Array<{ symbol: string; positionAmt: string; entryPrice: string; unRealizedProfit: string }>>,
      fetch(`${TESTNET_BASE}/fapi/v2/balance?${balQs}&signature=${sign(balQs)}`, { headers: { "X-MBX-APIKEY": apiKey } }).then((r) => r.json()) as Promise<Array<{ asset: string; balance: string; availableBalance: string }>>,
      fetch(`${TESTNET_BASE}/fapi/v1/klines?symbol=BTCUSDT&interval=${INTERVAL}&limit=200`).then((r) => r.json()) as Promise<BinanceKline[]>,
    ]);

    const markPrice = Number(markRes.markPrice);
    const pos = posRes.find((p) => p.symbol === "BTCUSDT");
    const posAmt = pos ? Number(pos.positionAmt) : 0;
    const entryPrice = pos ? Number(pos.entryPrice) : 0;
    const uPnl = pos ? Number(pos.unRealizedProfit) : 0;
    const usdtBal = balRes.find((b) => b.asset === "USDT");
    const balance = usdtBal ? Number(usdtBal.balance) : 0;

    const now = Date.now();
    const candles: Candle[] = klineRes
      .filter((k) => k[6] <= now)
      .map((k) => ({ t: new Date(k[0]).toISOString(), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }));

    const strategy = getStrategy(STRATEGY_ID);
    let signal = 0;
    let atrVal = 0;
    if (strategy && candles.length > 10) {
      const params: Record<string, number> = {};
      for (const p of strategy.params) params[p.key] = p.default;
      const signals = strategy.generateSignals(candles, params);
      signal = signals[signals.length - 1] ?? 0;
      const atrSeries = atr(highsArr(candles), lowsArr(candles), closesArr(candles), ATR_PERIOD);
      atrVal = atrSeries[atrSeries.length - 1] ?? 0;
    }

    const posLabel = posAmt > 0 ? "🟢 LONG" : posAmt < 0 ? "🔴 SHORT" : "⚪ FLAT";
    const signalLabel = signal === 1 ? "🟢 LONG" : signal === -1 ? "🔴 SHORT" : "⚪ FLAT";
    const intervalMs = INTERVAL_MS[INTERVAL];
    const lastCandle = candles[candles.length - 1];
    const nextClose = lastCandle ? new Date(new Date(lastCandle.t).getTime() + intervalMs * 2).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-";

    let msg =
      `📡 <b>Status Live Bot</b>\n` +
      `───────────────────────\n` +
      `Mark Price: <b>$${markPrice.toFixed(2)}</b>\n` +
      `Posisi: <b>${posLabel}</b>`;

    if (posAmt !== 0) {
      msg += ` (${Math.abs(posAmt)} BTC)\nEntry: $${entryPrice.toFixed(2)}\nuPnL: <b>${uPnl >= 0 ? "+" : ""}$${uPnl.toFixed(2)}</b>`;
    }

    msg +=
      `\n───────────────────────\n` +
      `Sinyal: <b>${signalLabel}</b>  |  ATR: ${atrVal.toFixed(2)}\n` +
      `Candle berikutnya: ${nextClose}\n` +
      `Balance: <b>$${balance.toFixed(2)}</b> USDT\n` +
      `Strategy: ${STRATEGY_ID}  |  TF: ${INTERVAL}`;

    await sendMessage(chatId, msg);
  } catch (e) {
    await sendMessage(chatId, `❌ Gagal ambil status: ${(e as Error).message}`);
  }
}

async function handleHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `🤖 <b>Algo Bot — Perintah Telegram</b>\n\n` +
    `/status           — posisi saat ini + sinyal + balance\n` +
    `/history [N]      — N trade terakhir (default 5, max 20)\n` +
    `/help             — tampilkan pesan ini\n\n` +
    `<i>Notifikasi otomatis dikirim saat bot open/close posisi.</i>`
  );
}

async function processUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  if (ALLOWED_CHAT_ID !== null && chatId !== ALLOWED_CHAT_ID) return;

  const parts = msg.text.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase().replace(/@\S+/, "");
  const args = parts.slice(1);

  try {
    if (command === "/history") await handleHistory(chatId, args);
    else if (command === "/status") await handleStatus(chatId);
    else if (command === "/help" || command === "/start") await handleHelp(chatId);
    else await sendMessage(chatId, `❓ Tidak dikenal: <code>${msg.text}</code>\n\nKirim /help untuk daftar perintah.`);
  } catch (e) {
    await sendMessage(chatId, `❌ Error: ${(e as Error).message}`).catch(() => {});
  }
}

export async function startTelegramPolling(): Promise<void> {
  if (!TOKEN || !ALLOWED_CHAT_ID) return;

  let offset = 0;
  let started = false;

  const poll = async () => {
    try {
      if (!started) {
        const me = await tgGet<{ username: string }>("getMe");
        console.log(`[telegram] Bot @${me.username} aktif, menunggu perintah...`);
        await sendMessage(ALLOWED_CHAT_ID, `🤖 <b>Server restart — Bot siap!</b>\nKirim /help untuk daftar perintah.`).catch(() => {});
        started = true;
      }

      const updates = await tgGet<TgUpdate[]>("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: "message",
      });

      for (const u of updates) {
        offset = u.update_id + 1;
        processUpdate(u).catch(() => {});
      }
    } catch {
      // silent retry
    }
    setTimeout(poll, 1000);
  };

  poll().catch(() => {});
}
