/**
 * Telegram Bot Polling
 *
 * Menjalankan Telegram bot yang menerima perintah dari user:
 *   /history [N]  — tampilkan N trade terakhir (default 5)
 *   /status       — status posisi saat ini dari Binance Testnet
 *   /help         — daftar perintah
 *
 * REQUIRED ENV:
 *   TELEGRAM_BOT_TOKEN   — dari @BotFather
 *   TELEGRAM_CHAT_ID     — chat ID kamu
 *   BINANCE_TESTNET_API_KEY    (opsional, untuk /status)
 *   BINANCE_TESTNET_API_SECRET (opsional, untuk /status)
 *
 * USAGE:
 *   pnpm --filter @workspace/api-server run telegram
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const TRADES_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../trade-history.json",
);

const TESTNET_BASE = "https://testnet.binancefuture.com";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

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
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
};

type TgResponse<T> = { ok: boolean; result: T };

// ---------------------------------------------------------------------------
// TELEGRAM API
// ---------------------------------------------------------------------------

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  ? Number(process.env.TELEGRAM_CHAT_ID)
  : null;

if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN tidak di-set. Exit.");
  process.exit(1);
}

async function tgGet<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const url = `https://api.telegram.org/bot${TOKEN}/${method}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  const data = (await res.json()) as TgResponse<T>;
  if (!data.ok) throw new Error(`Telegram ${method} failed`);
  return data.result;
}

async function tgPost<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const url = `https://api.telegram.org/bot${TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as TgResponse<T>;
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(data)}`);
  return data.result;
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await tgPost("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

// ---------------------------------------------------------------------------
// COMMAND HANDLERS
// ---------------------------------------------------------------------------

function loadTrades(): TradeRecord[] {
  try {
    return JSON.parse(fs.readFileSync(TRADES_FILE, "utf-8")) as TradeRecord[];
  } catch {
    return [];
  }
}

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

function formatTrade(t: TradeRecord, index: number): string {
  const side = t.side === "BUY" ? "🟢 LONG" : "🔴 SHORT";
  const status = t.status === "open" ? "🔵 OPEN" : t.exitReason === "TP" ? "✅ TP" : t.exitReason === "SL" ? "❌ SL" : "🔄 SIGNAL";
  const pnl = t.pnl !== undefined
    ? `PnL: <b>${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}</b>\n`
    : "";
  const exit = t.exitPrice
    ? `Exit: $${t.exitPrice.toFixed(2)} @ ${formatTime(t.exitTime!)}\n`
    : "";

  return (
    `<b>#${index} ${side} — ${status}</b>\n` +
    `Pair: ${t.symbol}  |  Qty: ${t.qty} BTC\n` +
    `Entry: <b>$${t.entryPrice.toFixed(2)}</b> @ ${formatTime(t.entryTime)}\n` +
    `SL: $${t.sl.toFixed(2)}  |  TP: $${t.tp.toFixed(2)}\n` +
    exit +
    pnl
  );
}

async function handleHistory(chatId: number, args: string[]): Promise<void> {
  const n = Math.min(20, Math.max(1, parseInt(args[0] ?? "5") || 5));
  const trades = loadTrades();

  if (trades.length === 0) {
    await sendMessage(chatId, "📭 Belum ada trade history.");
    return;
  }

  const recent = trades.slice(-n).reverse();
  const totalPnl = trades
    .filter((t) => t.pnl !== undefined)
    .reduce((acc, t) => acc + (t.pnl ?? 0), 0);

  const openCount = trades.filter((t) => t.status === "open").length;
  const closedCount = trades.filter((t) => t.status === "closed").length;
  const wins = trades.filter((t) => t.exitReason === "TP").length;
  const losses = trades.filter((t) => t.exitReason === "SL").length;
  const winRate = closedCount > 0 ? ((wins / closedCount) * 100).toFixed(1) : "0";

  let msg =
    `📊 <b>Trade History</b> (${n} terakhir dari ${trades.length} total)\n` +
    `───────────────────────\n` +
    `Total PnL: <b>${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}</b>\n` +
    `Win Rate: ${wins}W / ${losses}L (${winRate}%)\n` +
    `Open: ${openCount}  |  Closed: ${closedCount}\n` +
    `───────────────────────\n\n`;

  for (let i = 0; i < recent.length; i++) {
    msg += formatTrade(recent[i]!, i + 1) + "\n";
  }

  await sendMessage(chatId, msg);
}

async function handleStatus(chatId: number): Promise<void> {
  const apiKey = process.env.BINANCE_TESTNET_API_KEY;
  const apiSecret = process.env.BINANCE_TESTNET_API_SECRET;

  if (!apiKey || !apiSecret) {
    await sendMessage(chatId,
      "⚠️ <b>Status tidak tersedia</b>\n" +
      "BINANCE_TESTNET_API_KEY / API_SECRET belum di-set.\n\n" +
      "Trade history: kirim /history"
    );
    return;
  }

  try {
    const merged: Record<string, string> = { recvWindow: "5000", timestamp: String(Date.now()) };
    const signedQuery = (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      const sig = crypto.createHmac("sha256", apiSecret).update(qs).digest("hex");
      return `${qs}&signature=${sig}`;
    };

    const posQs = signedQuery({ ...merged, symbol: "BTCUSDT" });
    const balQs = signedQuery({ ...merged });

    const [markRes, posRes, balRes] = await Promise.all([
      fetch(`${TESTNET_BASE}/fapi/v1/premiumIndex?symbol=BTCUSDT`).then((r) => r.json()) as Promise<{ markPrice: string }>,
      fetch(`${TESTNET_BASE}/fapi/v2/positionRisk?${posQs}`, { headers: { "X-MBX-APIKEY": apiKey } })
        .then((r) => r.json()) as Promise<Array<{ symbol: string; positionAmt: string; entryPrice: string; unRealizedProfit: string }>>,
      fetch(`${TESTNET_BASE}/fapi/v2/balance?${balQs}`, { headers: { "X-MBX-APIKEY": apiKey } })
        .then((r) => r.json()) as Promise<Array<{ asset: string; balance: string; availableBalance: string }>>,
    ]);

    const markPrice = Number(markRes.markPrice);
    const pos = posRes.find((p) => p.symbol === "BTCUSDT");
    const posAmt = pos ? Number(pos.positionAmt) : 0;
    const entryPrice = pos ? Number(pos.entryPrice) : 0;
    const uPnl = pos ? Number(pos.unRealizedProfit) : 0;
    const usdtBal = balRes.find((b) => b.asset === "USDT");
    const balance = usdtBal ? Number(usdtBal.balance) : 0;
    const available = usdtBal ? Number(usdtBal.availableBalance) : 0;

    const posLabel = posAmt > 0 ? "🟢 LONG" : posAmt < 0 ? "🔴 SHORT" : "⚪ FLAT";

    let msg =
      `📡 <b>Status Live Bot</b>\n` +
      `───────────────────────\n` +
      `Mark Price: <b>$${markPrice.toFixed(2)}</b>\n` +
      `Posisi: <b>${posLabel}</b>`;

    if (posAmt !== 0) {
      msg +=
        ` (${Math.abs(posAmt)} BTC)\n` +
        `Entry: $${entryPrice.toFixed(2)}\n` +
        `Unrealized PnL: <b>${uPnl >= 0 ? "+" : ""}$${uPnl.toFixed(2)}</b>`;
    } else {
      msg += "\n";
    }

    msg +=
      `\n───────────────────────\n` +
      `Balance: <b>$${balance.toFixed(2)}</b> USDT\n` +
      `Available: $${available.toFixed(2)} USDT`;

    await sendMessage(chatId, msg);
  } catch (e) {
    await sendMessage(chatId, `❌ Gagal ambil status: ${(e as Error).message}`);
  }
}

async function handleHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `🤖 <b>Algo Bot — Daftar Perintah</b>\n\n` +
    `/history [N]  — tampilkan N trade terakhir (default 5)\n` +
    `/status       — cek posisi saat ini di Binance Testnet\n` +
    `/help         — tampilkan pesan ini\n\n` +
    `<i>Notifikasi otomatis dikirim saat open/close posisi.</i>`
  );
}

// ---------------------------------------------------------------------------
// POLLING LOOP
// ---------------------------------------------------------------------------

async function processUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;

  // Security: hanya balas chat yang diizinkan
  if (ALLOWED_CHAT_ID !== null && chatId !== ALLOWED_CHAT_ID) {
    console.warn(`[tg-bot] pesan dari chat ID tidak dikenal: ${chatId}`);
    return;
  }

  const text = msg.text.trim();
  const parts = text.split(/\s+/);
  const command = parts[0]?.toLowerCase().replace(/@\S+/, "") ?? "";
  const args = parts.slice(1);

  console.log(`[tg-bot] perintah: ${command} dari chat ${chatId}`);

  try {
    if (command === "/history") {
      await handleHistory(chatId, args);
    } else if (command === "/status") {
      await handleStatus(chatId);
    } else if (command === "/help" || command === "/start") {
      await handleHelp(chatId);
    } else {
      await sendMessage(chatId, `❓ Perintah tidak dikenal: <code>${text}</code>\n\nKirim /help untuk daftar perintah.`);
    }
  } catch (e) {
    console.error(`[tg-bot] error saat handle command:`, e);
    await sendMessage(chatId, `❌ Error: ${(e as Error).message}`);
  }
}

async function startPolling(): Promise<void> {
  console.log("[tg-bot] Memulai Telegram bot polling...");

  let offset = 0;

  try {
    const me = await tgGet<{ username: string }>("getMe");
    console.log(`[tg-bot] Bot aktif: @${me.username}`);

    if (ALLOWED_CHAT_ID) {
      await sendMessage(
        ALLOWED_CHAT_ID,
        `🤖 <b>Telegram Bot Aktif!</b>\n` +
        `Kirim /help untuk daftar perintah.\n` +
        `Kirim /history untuk lihat riwayat trade.`
      );
    }
  } catch (e) {
    console.error("[tg-bot] Gagal connect ke Telegram:", (e as Error).message);
    process.exit(1);
  }

  while (true) {
    try {
      const updates = await tgGet<TgUpdate[]>("getUpdates", {
        offset: offset,
        timeout: 30,
        allowed_updates: "message",
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        await processUpdate(update);
      }
    } catch (e) {
      console.error("[tg-bot] polling error:", (e as Error).message);
      await sleep(5000);
    }
  }
}

startPolling().catch((e) => {
  console.error("[tg-bot] fatal:", e);
  process.exit(1);
});
