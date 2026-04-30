import { useMemo, useState } from "react";
import type { Trade } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatDateTime,
  formatDollar,
  formatDollarSigned,
  formatPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  trades: Trade[];
};

const reasonStyles: Record<Trade["exitReason"], string> = {
  take_profit: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  stop_loss: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  signal_exit: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
  end_of_data: "bg-muted text-muted-foreground border-border",
  liquidation: "bg-red-500/20 text-red-300 border-red-500/40",
  time_stop: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
};

const reasonLabel: Record<Trade["exitReason"], string> = {
  take_profit: "TP",
  stop_loss: "SL",
  signal_exit: "EXIT",
  end_of_data: "EOD",
  liquidation: "LIQ",
  time_stop: "TIME",
};

type SortKey =
  | "index"
  | "entry"
  | "pnl"
  | "pnlPct"
  | "fee"
  | "funding"
  | "side";
type Filter = "all" | "wins" | "losses" | "in_sample" | "out_of_sample";

export function TradesTable({ trades }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    let rows = trades.map((t, i) => ({ t, i }));
    switch (filter) {
      case "wins":
        rows = rows.filter((r) => r.t.pnl > 0);
        break;
      case "losses":
        rows = rows.filter((r) => r.t.pnl <= 0);
        break;
      case "in_sample":
        rows = rows.filter((r) => r.t.sample === "in_sample");
        break;
      case "out_of_sample":
        rows = rows.filter((r) => r.t.sample === "out_of_sample");
        break;
    }
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case "index":
          return (a.i - b.i) * dir;
        case "entry":
          // entryTime is an ISO timestamp string — lexicographic order matches chronological order.
          return a.t.entryTime.localeCompare(b.t.entryTime) * dir;
        case "pnl":
          return (a.t.pnl - b.t.pnl) * dir;
        case "pnlPct":
          return (a.t.pnlPct - b.t.pnlPct) * dir;
        case "fee":
          return (a.t.feePaid - b.t.feePaid) * dir;
        case "funding": {
          const af = Number(a.t.fundingPaid ?? 0);
          const bf = Number(b.t.fundingPaid ?? 0);
          return (af - bf) * dir;
        }
        case "side":
          return a.t.side.localeCompare(b.t.side) * dir;
        default:
          return 0;
      }
    });
    return rows;
  }, [trades, filter, sortKey, sortDir]);

  const summary = useMemo(() => {
    const rows = filtered.map((r) => r.t);
    const totalPnl = rows.reduce((s, t) => s + t.pnl, 0);
    const totalFees = rows.reduce((s, t) => s + t.feePaid, 0);
    const totalFunding = rows.reduce((s, t) => s + (t.fundingPaid ?? 0), 0);
    const wins = rows.filter((t) => t.pnl > 0).length;
    const winRate = rows.length > 0 ? (wins / rows.length) * 100 : 0;
    return { totalPnl, totalFees, totalFunding, wins, winRate, n: rows.length };
  }, [filtered]);

  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-card-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        No trades were generated. Try a longer lookback, smaller ATR multiplier,
        or different EMA periods.
      </div>
    );
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "index" || key === "entry" ? "asc" : "desc");
    }
  };

  const headerBtn = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={cn(
        "font-normal hover:text-foreground transition-colors w-full",
        align === "right" ? "text-right" : "text-left",
        sortKey === key ? "text-primary" : "text-muted-foreground",
      )}
    >
      {label}
      {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "wins", label: "Wins" },
    { key: "losses", label: "Losses" },
    { key: "in_sample", label: "IS" },
    { key: "out_of_sample", label: "OOS" },
  ];

  return (
    <div className="rounded-lg border border-card-border bg-card/60 overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 px-2 sm:px-3 py-2 border-b border-border/60 bg-card/95">
        {filters.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
            className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider"
          >
            {f.label}
          </Button>
        ))}
        <div className="ml-auto text-[10px] font-mono text-muted-foreground">
          {summary.n} trades · win {summary.winRate.toFixed(1)}%
        </div>
      </div>
      <ScrollArea className="h-[360px] sm:h-[440px]">
        <table className="w-full text-xs sm:text-sm font-mono min-w-[820px]">
          <thead className="sticky top-0 bg-card/95 backdrop-blur z-10">
            <tr className="text-left text-muted-foreground">
              <th className="px-2 sm:px-3 py-2">{headerBtn("index", "#")}</th>
              <th className="px-2 sm:px-3 py-2">{headerBtn("side", "Side")}</th>
              <th className="px-2 sm:px-3 py-2 font-normal">Sample</th>
              <th className="px-2 sm:px-3 py-2">{headerBtn("entry", "Entry")}</th>
              <th className="px-2 sm:px-3 py-2 font-normal hidden sm:table-cell">
                Exit
              </th>
              <th className="px-2 sm:px-3 py-2 font-normal text-right">Price</th>
              <th className="px-2 sm:px-3 py-2 font-normal text-right hidden md:table-cell">
                SL / TP
              </th>
              <th className="px-2 sm:px-3 py-2 text-right">
                {headerBtn("pnlPct", "P&L%", "right")}
              </th>
              <th className="px-2 sm:px-3 py-2 text-right">
                {headerBtn("pnl", "P&L $", "right")}
              </th>
              <th className="px-2 sm:px-3 py-2 text-right hidden md:table-cell">
                {headerBtn("fee", "Fee", "right")}
              </th>
              <th className="px-2 sm:px-3 py-2 text-right hidden md:table-cell">
                {headerBtn("funding", "Funding", "right")}
              </th>
              <th className="px-2 sm:px-3 py-2 font-normal text-right">Why</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ t, i }) => {
              const isWin = t.pnl > 0;
              const funding = t.fundingPaid ?? 0;
              return (
                <tr
                  key={i}
                  className="border-t border-border/40 hover:bg-elevate-1"
                >
                  <td className="px-2 sm:px-3 py-1.5 text-muted-foreground">
                    {i + 1}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <span
                      className={cn(
                        "uppercase text-[10px] tracking-wider",
                        t.side === "long"
                          ? "text-emerald-300"
                          : "text-fuchsia-300",
                      )}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <span
                      className={cn(
                        "text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
                        t.sample === "in_sample"
                          ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                          : "bg-purple-500/10 text-purple-300 border-purple-500/30",
                      )}
                    >
                      {t.sample === "in_sample" ? "IS" : "OOS"}
                    </span>
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                    {formatDateTime(t.entryTime)}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                    {formatDateTime(t.exitTime)}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-right whitespace-nowrap">
                    {formatDollar(t.entryPrice)}
                    <span className="text-muted-foreground"> → </span>
                    {formatDollar(t.exitPrice)}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-right whitespace-nowrap text-muted-foreground hidden md:table-cell">
                    <span className="text-amber-300/90">
                      {formatDollar(t.stopPrice)}
                    </span>
                    <span className="mx-1">/</span>
                    <span className="text-emerald-300/90">
                      {formatDollar(t.takeProfitPrice)}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-2 sm:px-3 py-1.5 text-right",
                      isWin ? "text-emerald-300" : "text-red-300",
                    )}
                  >
                    {formatPercent(t.pnlPct)}
                  </td>
                  <td
                    className={cn(
                      "px-2 sm:px-3 py-1.5 text-right",
                      isWin ? "text-emerald-300" : "text-red-300",
                    )}
                  >
                    {formatDollarSigned(t.pnl)}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-right text-muted-foreground hidden md:table-cell">
                    {formatDollar(t.feePaid)}
                  </td>
                  <td
                    className={cn(
                      "px-2 sm:px-3 py-1.5 text-right hidden md:table-cell",
                      funding > 0
                        ? "text-amber-300/80"
                        : "text-muted-foreground",
                    )}
                  >
                    {funding > 0 ? formatDollar(funding) : "—"}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-right">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] py-0 px-1.5",
                        reasonStyles[t.exitReason],
                      )}
                    >
                      {reasonLabel[t.exitReason]}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-card/95 backdrop-blur border-t-2 border-border/80">
            <tr className="text-[11px]">
              <td colSpan={7} className="px-2 sm:px-3 py-2 text-right text-muted-foreground uppercase tracking-wider">
                Totals ({summary.n})
              </td>
              <td
                className={cn(
                  "px-2 sm:px-3 py-2 text-right",
                  summary.totalPnl >= 0 ? "text-emerald-300" : "text-red-300",
                )}
              >
                {summary.wins}W
              </td>
              <td
                className={cn(
                  "px-2 sm:px-3 py-2 text-right",
                  summary.totalPnl >= 0 ? "text-emerald-300" : "text-red-300",
                )}
              >
                {formatDollarSigned(summary.totalPnl)}
              </td>
              <td className="px-2 sm:px-3 py-2 text-right text-muted-foreground hidden md:table-cell">
                {formatDollar(summary.totalFees)}
              </td>
              <td className="px-2 sm:px-3 py-2 text-right text-muted-foreground hidden md:table-cell">
                {formatDollar(summary.totalFunding)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </ScrollArea>
    </div>
  );
}
