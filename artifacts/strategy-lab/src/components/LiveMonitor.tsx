import { useEffect, useState } from "react";

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

function useCountdown(targetMs: number | undefined) {
  const [remaining, setRemaining] = useState<number>(0);
  useEffect(() => {
    if (!targetMs) return;
    const tick = () => setRemaining(Math.max(0, targetMs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1_000);
  return remaining > 0
    ? `${h > 0 ? `${h}h ` : ""}${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`
    : "closing…";
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

export function LiveMonitor() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>("");

  const countdown = useCountdown(status?.nextCandleCloseMs);

  const fetchStatus = () => {
    fetch("/api/bot/status")
      .then((r) => r.json())
      .then((d: BotStatus) => {
        setStatus(d);
        setLastUpdate(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        setLoading(false);
      })
      .catch(() => {
        setStatus({ connected: false, reason: "Cannot reach API server" });
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
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

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Live dot + title */}
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
        <div className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
          <span>update {lastUpdate}</span>
        </div>
      </div>

      {/* Main stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* BTC Price */}
        <div className="rounded-xl border border-border bg-card p-4">
          <Stat
            label="BTC Mark Price"
            value={`$${status.markPrice?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            sub={`ATR(14): ${status.atr?.toFixed(2)}`}
          />
        </div>

        {/* Signal */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Signal Strategi</span>
          <SignalBadge signal={status.signal ?? 0} />
          {status.signal !== 0 && status.sl && status.tp && (
            <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
              SL ${status.sl.toFixed(0)} · TP ${status.tp.toFixed(0)}
            </div>
          )}
        </div>

        {/* Position */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Posisi Aktif</span>
          <PositionBadge side={pos.side} />
          {pos.side !== "FLAT" ? (
            <div className="text-[10px] font-mono text-muted-foreground">
              <div>{Math.abs(pos.amt)} BTC @ ${pos.entryPrice.toFixed(2)}</div>
              <div className={pnlColor}>uPnL: {pos.unrealizedPnl >= 0 ? "+" : ""}${pos.unrealizedPnl.toFixed(2)}</div>
            </div>
          ) : (
            <div className="text-[10px] font-mono text-muted-foreground">Menunggu sinyal</div>
          )}
        </div>

        {/* Countdown */}
        <div className="rounded-xl border border-border bg-card p-4">
          <Stat
            label="Candle Close Berikutnya"
            value={countdown}
            sub={`1H · ${status.lastCandle ? new Date(status.lastCandle.time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB (last closed)" : ""}`}
          />
        </div>
      </div>

      {/* Balance + Capital usage */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap gap-x-8 gap-y-3">
        <Stat
          label="Balance Testnet"
          value={`$${status.balance?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`Tersedia: $${status.availableBalance?.toFixed(2)}`}
        />
        <Stat
          label="Margin / Trade"
          value={`$${marginPerTrade.toFixed(2)}`}
          sub={`${cfg.riskPct}% dari basis $${cfg.capital}`}
          color="text-primary"
        />
        <Stat
          label="Notional / Trade"
          value={`$${notionalPerTrade.toFixed(2)}`}
          sub={`Margin × ${cfg.leverage}× leverage`}
          color="text-primary"
        />
        <Stat
          label="Prediksi Trade / Minggu"
          value="2–5"
          sub="Berdasarkan pola fractal 1H BTC"
        />
        <Stat
          label="Maks Risiko / Trade"
          value={`$${marginPerTrade.toFixed(2)}`}
          sub={`= ${cfg.riskPct}% × $${cfg.capital} basis`}
          color="text-amber-400"
        />
        <Stat
          label="Mode"
          value="TESTNET"
          sub="Paper trading — uang virtual"
          color="text-muted-foreground"
        />
      </div>

      {/* Info note */}
      <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-[11px] font-mono text-muted-foreground leading-relaxed">
        <span className="text-primary font-bold">Cara kerja: </span>
        Bot polling setiap 5 detik. Hanya bertindak saat candle 1H baru close. Strategy <span className="text-foreground">{cfg.strategyName}</span> mendeteksi 5-bar fractal pattern → buka LONG/SHORT dengan SL (ATR×1.5) &amp; TP (ATR×3) dijaga software. Posisi ditutup otomatis jika harga tembus level SL atau TP, atau signal berbalik.
      </div>
    </div>
  );
}
