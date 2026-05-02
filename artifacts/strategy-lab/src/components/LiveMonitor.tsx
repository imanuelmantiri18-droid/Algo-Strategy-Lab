import { useEffect, useRef, useState } from "react";
import { CandleChart } from "./CandleChart";

type BotStatus = {
  connected: boolean;
  reason?: string;
  ts?: number;
  symbol?: string;
  markPrice?: number;
  balance?: number;
  availableBalance?: number;
  position?: { amt: number; side: "LONG" | "SHORT" | "FLAT"; entryPrice: number; unrealizedPnl: number };
  signal?: number;
  atr?: number;
  sl?: number | null;
  tp?: number | null;
  lastCandle?: { time: string; close: number } | null;
  nextCandleCloseMs?: number;
  config?: {
    strategyId: string;
    strategyName: string;
    interval: string;
    leverage: number;
    riskPct: number;
    capital: number;
  };
};

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

function useCountdown(targetMs: number | undefined) {
  const [remaining, setRemaining] = useState<number>(0);
  useEffect(() => {
    if (!targetMs) return;
    const tick = () => setRemaining(Math.max(0, targetMs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  if (remaining <= 0) return "closing…";
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1_000);
  return `${h > 0 ? `${h}h ` : ""}${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={`text-sm sm:text-base font-mono font-semibold leading-tight ${color ?? "text-foreground"}`}>{value}</span>
      {sub && <span className="text-[10px] font-mono text-muted-foreground">{sub}</span>}
    </div>
  );
}

function SignalBadge({ signal }: { signal: number }) {
  if (signal === 1) return <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">LONG ▲</span>;
  if (signal === -1) return <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/30">SHORT ▼</span>;
  return <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-muted text-muted-foreground border border-border">FLAT ─</span>;
}

function PositionBadge({ side }: { side: "LONG" | "SHORT" | "FLAT" }) {
  if (side === "LONG") return <span className="font-mono font-bold text-emerald-400">LONG ▲</span>;
  if (side === "SHORT") return <span className="font-mono font-bold text-red-400">SHORT ▼</span>;
  return <span className="font-mono font-bold text-muted-foreground">FLAT ─</span>;
}

function SideBadge({ side }: { side: "BUY" | "SELL" }) {
  return side === "BUY"
    ? <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400">LONG</span>
    : <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/15 text-red-400">SHORT</span>;
}

function ReasonBadge({ reason }: { reason?: string }) {
  if (reason === "SL") return <span className="text-[10px] font-mono text-red-400">SL</span>;
  if (reason === "TP") return <span className="text-[10px] font-mono text-emerald-400">TP</span>;
  if (reason === "signal_exit") return <span className="text-[10px] font-mono text-amber-400">signal</span>;
  return <span className="text-[10px] font-mono text-muted-foreground">open</span>;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtPrice(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// AUDIO ALERT — uses Web Audio API, no external deps
// ---------------------------------------------------------------------------

function playBeep(type: "open" | "close_profit" | "close_loss") {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const configs =
      type === "open"
        ? [{ freq: 520, dur: 0.12, t: 0 }, { freq: 660, dur: 0.18, t: 0.14 }]
        : type === "close_profit"
        ? [{ freq: 440, dur: 0.1, t: 0 }, { freq: 550, dur: 0.1, t: 0.12 }, { freq: 660, dur: 0.2, t: 0.24 }]
        : [{ freq: 330, dur: 0.15, t: 0 }, { freq: 260, dur: 0.25, t: 0.17 }];

    for (const { freq, dur, t } of configs) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g);
      g.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      g.gain.setValueAtTime(0.18, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + dur + 0.05);
    }
    setTimeout(() => ctx.close(), 2000);
  } catch { /* AudioContext not supported */ }
}

function sendBrowserNotif(title: string, body: string, icon = "📊") {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification(`${icon} ${title}`, { body, silent: true });
  }
}

export function LiveMonitor() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifLog, setNotifLog] = useState<string[]>([]);

  const prevTradeCount = useRef(0);
  const prevOpenId = useRef<string | null>(null);
  const isFirstLoad = useRef(true);

  const countdown = useCountdown(status?.nextCandleCloseMs);

  // Request browser notification permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined") {
      if (Notification.permission === "granted") setNotifEnabled(true);
    }
  }, []);

  function requestNotifPermission() {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission().then((p) => {
      setNotifEnabled(p === "granted");
    });
  }

  function addLog(msg: string) {
    setNotifLog((prev) => [`${new Date().toLocaleTimeString("id-ID")} — ${msg}`, ...prev].slice(0, 10));
  }

  function checkAlerts(newTrades: TradeRecord[]) {
    if (isFirstLoad.current) {
      // On first load, just record baseline — don't fire alerts for existing trades
      prevTradeCount.current = newTrades.length;
      const openT = newTrades.find((t) => t.status === "open");
      prevOpenId.current = openT?.id ?? null;
      isFirstLoad.current = false;
      return;
    }

    const openTrade = newTrades.find((t) => t.status === "open");

    // NEW trade opened
    if (openTrade && openTrade.id !== prevOpenId.current) {
      const dir = openTrade.side === "BUY" ? "LONG ▲" : "SHORT ▼";
      const msg = `Trade dibuka: ${dir} ${openTrade.qty} BTC @ $${openTrade.entryPrice.toFixed(2)}`;
      playBeep("open");
      sendBrowserNotif("Bot: Trade Baru!", `${dir} ${openTrade.qty} BTC @ $${openTrade.entryPrice.toFixed(2)}  |  SL $${openTrade.sl.toFixed(2)}  TP $${openTrade.tp.toFixed(2)}`, "🚀");
      addLog(msg);
      prevOpenId.current = openTrade.id;
    }

    // Trade CLOSED (was open before, now closed)
    if (prevOpenId.current && !openTrade) {
      const closedTrade = newTrades.find((t) => t.id === prevOpenId.current && t.status === "closed");
      if (closedTrade) {
        const pnl = closedTrade.pnl ?? 0;
        const dir = closedTrade.side === "BUY" ? "LONG" : "SHORT";
        const pnlStr = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)}`;
        const reason = closedTrade.exitReason?.toUpperCase() ?? "closed";
        const msg = `Trade ditutup (${reason}): ${dir} ${pnlStr}`;
        playBeep(pnl >= 0 ? "close_profit" : "close_loss");
        sendBrowserNotif(
          `Bot: Trade ${reason} ${pnl >= 0 ? "✅ Profit" : "❌ Loss"}`,
          `${dir} @ exit $${(closedTrade.exitPrice ?? 0).toFixed(2)}  |  P&L ${pnlStr}`,
          pnl >= 0 ? "💰" : "🔴",
        );
        addLog(msg);
      }
      prevOpenId.current = null;
    }

    prevTradeCount.current = newTrades.length;
  }

  const fetchAll = () => {
    const t1 = fetch("/api/bot/status")
      .then((r) => r.json())
      .then((d: BotStatus) => {
        setStatus(d);
        setLastUpdate(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      })
      .catch(() => setStatus({ connected: false, reason: "Cannot reach API server" }));

    const t2 = fetch("/api/bot/trades")
      .then((r) => r.json())
      .then((d: { trades: TradeRecord[] }) => {
        const sorted = (d.trades ?? []).slice().reverse();
        checkAlerts(d.trades ?? []);
        setTrades(sorted);
      })
      .catch(() => {});

    Promise.all([t1, t2]).then(() => setLoading(false));
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 flex items-center gap-3 text-muted-foreground font-mono text-sm">
        <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
        Connecting to Binance Testnet…
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 font-mono">
        <div className="flex items-center gap-2 text-sm text-red-400">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          Bot tidak terhubung
        </div>
        <p className="text-xs text-muted-foreground mt-2">{status?.reason ?? "Periksa BINANCE_TESTNET_API_KEY dan BINANCE_TESTNET_API_SECRET."}</p>
      </div>
    );
  }

  const pos = status.position!;
  const cfg = status.config!;
  const pnlColor = pos.unrealizedPnl > 0 ? "text-emerald-400" : pos.unrealizedPnl < 0 ? "text-red-400" : "text-muted-foreground";
  const marginPerTrade = (cfg.capital * cfg.riskPct) / 100;
  const notionalPerTrade = marginPerTrade * cfg.leverage;

  // Trade history summary
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const totalPnl = closed.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const openTrade = trades.find((t) => t.status === "open");

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]" />
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-emerald-400">LIVE BOT AKTIF</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
          <span>{cfg.strategyName}</span>
          <span className="text-border">·</span>
          <span>{cfg.interval.toUpperCase()}</span>
          <span className="text-border">·</span>
          <span>{cfg.leverage}×</span>
          <span className="text-border">·</span>
          <span>{cfg.riskPct}% risk</span>
          <span className="text-border">·</span>
          <span>Basis ${cfg.capital}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {notifEnabled ? (
            <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <span>🔔</span> Notif aktif
            </span>
          ) : (
            <button
              onClick={requestNotifPermission}
              className="text-[10px] font-mono px-2 py-1 rounded border border-border bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              🔔 Aktifkan notifikasi
            </button>
          )}
          <span className="text-[10px] font-mono text-muted-foreground">update {lastUpdate}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <Stat
            label="BTC Mark Price"
            value={`$${status.markPrice?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            sub={`ATR(14): ${status.atr?.toFixed(2)}`}
          />
        </div>

        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Signal Strategi</span>
          <SignalBadge signal={status.signal ?? 0} />
          {status.signal !== 0 && status.sl && status.tp && (
            <div className="text-[10px] font-mono text-muted-foreground">
              SL {fmtPrice(status.sl)} · TP {fmtPrice(status.tp)}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Posisi Aktif</span>
          <PositionBadge side={pos.side} />
          {pos.side !== "FLAT" ? (
            <div className="text-[10px] font-mono text-muted-foreground">
              <div>{Math.abs(pos.amt)} BTC @ {fmtPrice(pos.entryPrice)}</div>
              <div className={pnlColor}>uPnL: {pos.unrealizedPnl >= 0 ? "+" : ""}${pos.unrealizedPnl.toFixed(4)}</div>
            </div>
          ) : (
            <div className="text-[10px] font-mono text-muted-foreground">Menunggu sinyal</div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <Stat
            label="Candle Close Berikutnya"
            value={countdown}
            sub={`1H · ${status.lastCandle ? fmtTime(status.lastCandle.time) + " (last closed)" : ""}`}
          />
        </div>
      </div>

      {/* Candlestick Chart */}
      <CandleChart
        markPrice={status.markPrice}
        sl={status.sl}
        tp={status.tp}
      />

      {/* Balance + Capital row */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap gap-x-8 gap-y-3">
        <Stat label="Balance Testnet" value={`$${status.balance?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} sub={`Tersedia: $${status.availableBalance?.toFixed(2)}`} />
        <Stat label="Margin / Trade" value={`$${marginPerTrade.toFixed(2)}`} sub={`${cfg.riskPct}% dari basis $${cfg.capital}`} color="text-primary" />
        <Stat label="Notional / Trade" value={`$${notionalPerTrade.toFixed(2)}`} sub={`Margin × ${cfg.leverage}× leverage`} color="text-primary" />
        {closed.length > 0 ? (
          <>
            <Stat label="Total Trade" value={String(closed.length)} sub={`${wins.length} menang · ${closed.length - wins.length} kalah`} />
            <Stat
              label="Win Rate"
              value={`${closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(0) : 0}%`}
              sub={`dari ${closed.length} closed`}
              color={wins.length / closed.length >= 0.5 ? "text-emerald-400" : "text-red-400"}
            />
            <Stat
              label="Total P&L"
              value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(4)}`}
              sub="semua closed trade"
              color={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
            />
          </>
        ) : (
          <Stat label="Prediksi Trade / Minggu" value="2–5" sub="Berdasarkan pola fractal 1H BTC" />
        )}
        <Stat label="Mode" value="TESTNET" sub="Paper trading — uang virtual" color="text-muted-foreground" />
      </div>

      {/* Trade History */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-foreground">Riwayat Trade</span>
          <span className="text-[10px] font-mono text-muted-foreground">{trades.length} trade · update setiap 5s</span>
        </div>

        {trades.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground font-mono text-sm">
            <div className="text-2xl mb-2">📭</div>
            Belum ada trade. Bot menunggu sinyal fractal breakout…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 text-left font-normal">#</th>
                  <th className="px-3 py-2 text-left font-normal">Arah</th>
                  <th className="px-3 py-2 text-left font-normal">Qty</th>
                  <th className="px-3 py-2 text-left font-normal">Entry</th>
                  <th className="px-3 py-2 text-left font-normal hidden sm:table-cell">Entry Time</th>
                  <th className="px-3 py-2 text-left font-normal">Exit</th>
                  <th className="px-3 py-2 text-left font-normal hidden sm:table-cell">Exit Time</th>
                  <th className="px-3 py-2 text-left font-normal">P&amp;L</th>
                  <th className="px-3 py-2 text-left font-normal">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const isOpen = t.status === "open";
                  const pnl = t.pnl ?? 0;
                  const pnlColor = isOpen ? "text-amber-400" : pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : "text-muted-foreground";
                  return (
                    <tr key={t.id} className={`border-b border-border/40 last:border-0 ${isOpen ? "bg-primary/5" : ""}`}>
                      <td className="px-3 py-2 text-muted-foreground">{trades.length - i}</td>
                      <td className="px-3 py-2"><SideBadge side={t.side} /></td>
                      <td className="px-3 py-2 text-foreground">{t.qty}</td>
                      <td className="px-3 py-2 text-foreground">{fmtPrice(t.entryPrice)}</td>
                      <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{fmtTime(t.entryTime)}</td>
                      <td className="px-3 py-2 text-foreground">
                        {t.exitPrice ? fmtPrice(t.exitPrice) : <span className="text-amber-400 animate-pulse">live…</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                        {t.exitTime ? fmtTime(t.exitTime) : "─"}
                      </td>
                      <td className={`px-3 py-2 font-semibold ${pnlColor}`}>
                        {isOpen
                          ? "open"
                          : pnl >= 0
                          ? `+$${pnl.toFixed(4)}`
                          : `-$${Math.abs(pnl).toFixed(4)}`}
                      </td>
                      <td className="px-3 py-2"><ReasonBadge reason={t.exitReason} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {openTrade && (
          <div className="px-4 py-2 border-t border-border bg-primary/5 text-[10px] font-mono text-muted-foreground flex gap-4">
            <span className="text-amber-400 font-semibold">● Posisi open</span>
            <span>SL: {fmtPrice(openTrade.sl)}</span>
            <span>TP: {fmtPrice(openTrade.tp)}</span>
            <span>Entry: {fmtPrice(openTrade.entryPrice)}</span>
          </div>
        )}
      </div>

      {/* Alert log */}
      {notifLog.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-foreground">Log Alert</span>
            <button
              onClick={() => setNotifLog([])}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              hapus
            </button>
          </div>
          <div className="px-4 py-2 space-y-1">
            {notifLog.map((entry, i) => (
              <div key={i} className="text-[11px] font-mono text-muted-foreground">{entry}</div>
            ))}
          </div>
        </div>
      )}

      {/* Info note */}
      <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-[11px] font-mono text-muted-foreground leading-relaxed">
        <span className="text-primary font-bold">Cara kerja: </span>
        Bot polling setiap 5 detik. Hanya bertindak saat candle 1H baru close. Strategy <span className="text-foreground">{cfg.strategyName}</span> mendeteksi 5-bar fractal → buka LONG/SHORT dengan SL (ATR×1.5) &amp; TP (ATR×3) dijaga software.
        {" "}Notifikasi + suara berbunyi otomatis saat trade dibuka atau ditutup — cukup biarkan tab ini terbuka di background.
      </div>
    </div>
  );
}
