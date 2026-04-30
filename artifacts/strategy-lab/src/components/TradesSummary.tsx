import { useMemo } from "react";
import type { Trade } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent, formatNumber, formatDollarSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

type Bucket = {
  count: number;
  totalPnlPct: number;
  totalPnl: number;
};

const EXIT_REASON_LABELS: Record<string, string> = {
  take_profit: "Take Profit",
  stop_loss: "Stop Loss",
  signal_exit: "Signal Exit",
  end_of_data: "End of Data",
  liquidation: "Liquidation",
  time_stop: "Time Stop",
};

const EXIT_REASON_COLOR: Record<string, string> = {
  take_profit: "text-emerald-300",
  stop_loss: "text-red-300",
  signal_exit: "text-cyan-300",
  end_of_data: "text-muted-foreground",
  liquidation: "text-red-500",
  time_stop: "text-amber-300",
};

function avg(arr: number[]) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function summarize(trades: Trade[]) {
  if (trades.length === 0) {
    return null;
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const longs = trades.filter((t) => t.side === "long");
  const shorts = trades.filter((t) => t.side === "short");

  const exitBuckets: Record<string, Bucket> = {};
  for (const t of trades) {
    const b = exitBuckets[t.exitReason] ?? {
      count: 0,
      totalPnlPct: 0,
      totalPnl: 0,
    };
    b.count += 1;
    b.totalPnlPct += t.pnlPct;
    b.totalPnl += t.pnl;
    exitBuckets[t.exitReason] = b;
  }

  const biggestWin = wins.reduce<Trade | null>(
    (best, t) => (best == null || t.pnlPct > best.pnlPct ? t : best),
    null,
  );
  const biggestLoss = losses.reduce<Trade | null>(
    (worst, t) => (worst == null || t.pnlPct < worst.pnlPct ? t : worst),
    null,
  );

  // Longest winning / losing streak
  let curWinStreak = 0;
  let curLossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  for (const t of trades) {
    if (t.pnl > 0) {
      curWinStreak += 1;
      curLossStreak = 0;
      if (curWinStreak > maxWinStreak) maxWinStreak = curWinStreak;
    } else {
      curLossStreak += 1;
      curWinStreak = 0;
      if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak;
    }
  }

  // Average holding time in hours
  const holdingHours = trades.map((t) => {
    const a = new Date(t.entryTime).getTime();
    const b = new Date(t.exitTime).getTime();
    return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 3_600_000 : 0;
  });

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    longs: longs.length,
    shorts: shorts.length,
    longWinRate:
      longs.length === 0
        ? 0
        : (longs.filter((t) => t.pnl > 0).length / longs.length) * 100,
    shortWinRate:
      shorts.length === 0
        ? 0
        : (shorts.filter((t) => t.pnl > 0).length / shorts.length) * 100,
    avgWinPct: avg(wins.map((t) => t.pnlPct)),
    avgLossPct: avg(losses.map((t) => t.pnlPct)),
    avgPnlPct: avg(trades.map((t) => t.pnlPct)),
    biggestWin,
    biggestLoss,
    maxWinStreak,
    maxLossStreak,
    avgHoldingHours: avg(holdingHours),
    totalFees: trades.reduce((s, t) => s + (t.feePaid ?? 0), 0),
    totalFunding: trades.reduce((s, t) => s + (t.fundingPaid ?? 0), 0),
    netPnl: trades.reduce((s, t) => s + t.pnl, 0),
    exitBuckets,
  };
}

export function TradesSummary({ trades }: { trades: Trade[] }) {
  const inSample = useMemo(
    () => summarize(trades.filter((t) => t.sample === "in_sample")),
    [trades],
  );
  const outSample = useMemo(
    () => summarize(trades.filter((t) => t.sample === "out_of_sample")),
    [trades],
  );

  if (!inSample && !outSample) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          No trades to summarize.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Win / Loss Breakdown</span>
          <span className="text-[10px] text-muted-foreground/70">
            in-sample · out-of-sample
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SegmentColumn label="In-Sample (Train)" data={inSample} accent="muted" />
          <SegmentColumn label="Out-of-Sample (Test)" data={outSample} accent="primary" />
        </div>
      </CardContent>
    </Card>
  );
}

type Summary = NonNullable<ReturnType<typeof summarize>>;

function SegmentColumn({
  label,
  data,
  accent,
}: {
  label: string;
  data: Summary | null;
  accent: "primary" | "muted";
}) {
  if (!data) {
    return (
      <div className="rounded-md border border-border/60 bg-card/30 p-3 text-[11px] text-muted-foreground">
        {label}: no trades in this window.
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-3",
        accent === "primary"
          ? "border-primary/40 bg-primary/5"
          : "border-border/60 bg-card/30",
      )}
    >
      <div
        className={cn(
          "text-[11px] font-mono uppercase tracking-wider",
          accent === "primary" ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Mini label="Trades" value={String(data.total)} />
        <Mini
          label="Wins"
          value={`${data.wins} · ${formatNumber(data.winRate, 1)}%`}
          color="text-emerald-300"
        />
        <Mini label="Losses" value={String(data.losses)} color="text-red-300" />

        <Mini label="Long" value={`${data.longs} · ${formatNumber(data.longWinRate, 0)}%`} />
        <Mini
          label="Short"
          value={`${data.shorts} · ${formatNumber(data.shortWinRate, 0)}%`}
        />
        <Mini
          label="Avg PnL"
          value={formatPercent(data.avgPnlPct, 2)}
          color={data.avgPnlPct >= 0 ? "text-emerald-300" : "text-red-300"}
        />

        <Mini
          label="Avg Win"
          value={formatPercent(data.avgWinPct, 2)}
          color="text-emerald-300"
        />
        <Mini
          label="Avg Loss"
          value={formatPercent(data.avgLossPct, 2)}
          color="text-red-300"
        />
        <Mini label="Avg Hold" value={`${formatNumber(data.avgHoldingHours, 1)}h`} />

        <Mini
          label="Best Trade"
          value={data.biggestWin ? formatPercent(data.biggestWin.pnlPct, 1) : "—"}
          color="text-emerald-300"
        />
        <Mini
          label="Worst Trade"
          value={data.biggestLoss ? formatPercent(data.biggestLoss.pnlPct, 1) : "—"}
          color="text-red-300"
        />
        <Mini
          label="Net PnL"
          value={formatDollarSigned(data.netPnl, 0)}
          color={data.netPnl >= 0 ? "text-emerald-300" : "text-red-300"}
        />

        <Mini
          label="Win Streak"
          value={String(data.maxWinStreak)}
          color="text-emerald-300"
        />
        <Mini
          label="Loss Streak"
          value={String(data.maxLossStreak)}
          color="text-red-300"
        />
        <Mini
          label="Fees+Funding"
          value={formatDollarSigned(-(data.totalFees + data.totalFunding), 0)}
          color="text-muted-foreground"
        />
      </div>

      <div className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
          Exit reasons
        </div>
        <div className="space-y-1">
          {Object.entries(data.exitBuckets)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([reason, bucket]) => {
              const pct = (bucket.count / data.total) * 100;
              return (
                <div key={reason} className="flex items-center gap-2 text-[11px] font-mono">
                  <div
                    className={cn(
                      "w-24 truncate",
                      EXIT_REASON_COLOR[reason] ?? "text-foreground",
                    )}
                  >
                    {EXIT_REASON_LABELS[reason] ?? reason}
                  </div>
                  <div className="flex-1 h-1.5 bg-border/50 rounded overflow-hidden">
                    <div
                      className={cn(
                        "h-full",
                        reason === "take_profit"
                          ? "bg-emerald-400/70"
                          : reason === "stop_loss"
                            ? "bg-red-400/70"
                            : reason === "liquidation"
                              ? "bg-red-600/80"
                              : "bg-cyan-400/60",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-14 text-right text-muted-foreground">
                    {bucket.count} · {formatNumber(pct, 0)}%
                  </div>
                  <div
                    className={cn(
                      "w-20 text-right",
                      bucket.totalPnl >= 0 ? "text-emerald-300/80" : "text-red-300/80",
                    )}
                  >
                    {formatDollarSigned(bucket.totalPnl, 0)}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60">
        {label}
      </div>
      <div className={cn("text-xs font-mono font-semibold", color ?? "text-foreground")}>
        {value}
      </div>
    </div>
  );
}
