import { useMemo, useState } from "react";
import type { Trade } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { formatPercent, formatNumber, formatDollarSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

const EXIT_REASON_LABEL: Record<string, string> = {
  take_profit: "TP",
  stop_loss: "SL",
  signal_exit: "Sig",
  end_of_data: "EOD",
  liquidation: "LIQ",
  time_stop: "Time",
};

const EXIT_REASON_COLOR: Record<string, string> = {
  take_profit: "text-emerald-300",
  stop_loss: "text-red-300",
  signal_exit: "text-cyan-300",
  end_of_data: "text-muted-foreground",
  liquidation: "text-red-500 font-bold",
  time_stop: "text-amber-300",
};

type SampleFilter = "all" | "in_sample" | "out_of_sample";
type ResultFilter = "all" | "win" | "loss";

const PAGE_SIZE = 25;

function formatDateTime(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

export function TradesTable({ trades }: { trades: Trade[] }) {
  const [sampleFilter, setSampleFilter] = useState<SampleFilter>("out_of_sample");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [sideFilter, setSideFilter] = useState<"all" | "long" | "short">("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let list = trades;
    if (sampleFilter !== "all") list = list.filter((t) => t.sample === sampleFilter);
    if (resultFilter === "win") list = list.filter((t) => t.pnl > 0);
    if (resultFilter === "loss") list = list.filter((t) => t.pnl <= 0);
    if (sideFilter !== "all") list = list.filter((t) => t.side === sideFilter);
    return list;
  }, [trades, sampleFilter, resultFilter, sideFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const goPage = (p: number) => setPage(Math.min(totalPages - 1, Math.max(0, p)));
  const resetPage = () => setPage(0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <FilterGroup
          label="Window"
          options={[
            { v: "all", l: "All" },
            { v: "in_sample", l: "In-Sample" },
            { v: "out_of_sample", l: "OOS" },
          ]}
          value={sampleFilter}
          onChange={(v) => {
            setSampleFilter(v as SampleFilter);
            resetPage();
          }}
        />
        <FilterGroup
          label="Result"
          options={[
            { v: "all", l: "All" },
            { v: "win", l: "Wins" },
            { v: "loss", l: "Losses" },
          ]}
          value={resultFilter}
          onChange={(v) => {
            setResultFilter(v as ResultFilter);
            resetPage();
          }}
        />
        <FilterGroup
          label="Side"
          options={[
            { v: "all", l: "All" },
            { v: "long", l: "Long" },
            { v: "short", l: "Short" },
          ]}
          value={sideFilter}
          onChange={(v) => {
            setSideFilter(v as "all" | "long" | "short");
            resetPage();
          }}
        />
        <span className="text-[10px] font-mono text-muted-foreground/70 ml-auto">
          {filtered.length} trades
        </span>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[11px] font-mono">
          <thead className="text-muted-foreground/70 uppercase tracking-wider">
            <tr className="border-b border-border/60">
              <th className="text-left py-1.5 px-2">#</th>
              <th className="text-left py-1.5 px-2">Entry</th>
              <th className="text-left py-1.5 px-2">Exit</th>
              <th className="text-center py-1.5 px-2">Side</th>
              <th className="text-right py-1.5 px-2">Entry $</th>
              <th className="text-right py-1.5 px-2">Exit $</th>
              <th className="text-center py-1.5 px-2">Why</th>
              <th className="text-right py-1.5 px-2">PnL %</th>
              <th className="text-right py-1.5 px-2">PnL $</th>
              <th className="text-center py-1.5 px-2">Win/Loss</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              const win = t.pnl > 0;
              const idx = safePage * PAGE_SIZE + i + 1;
              return (
                <tr
                  key={`${t.entryTime}-${i}`}
                  className={cn(
                    "border-b border-border/30 hover:bg-card/40",
                    t.exitReason === "liquidation" && "bg-red-500/10",
                  )}
                >
                  <td className="py-1.5 px-2 text-muted-foreground">{idx}</td>
                  <td className="py-1.5 px-2">{formatDateTime(t.entryTime)}</td>
                  <td className="py-1.5 px-2">{formatDateTime(t.exitTime)}</td>
                  <td className="py-1.5 px-2 text-center">
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold",
                        t.side === "long"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-red-500/15 text-red-300",
                      )}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right text-muted-foreground">
                    {formatNumber(t.entryPrice, 2)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-muted-foreground">
                    {formatNumber(t.exitPrice, 2)}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wider",
                        EXIT_REASON_COLOR[t.exitReason] ?? "text-muted-foreground",
                      )}
                      title={t.exitReason}
                    >
                      {EXIT_REASON_LABEL[t.exitReason] ?? t.exitReason}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "py-1.5 px-2 text-right",
                      win ? "text-emerald-300" : "text-red-300",
                    )}
                  >
                    {formatPercent(t.pnlPct, 2)}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 px-2 text-right",
                      win ? "text-emerald-300" : "text-red-300",
                    )}
                  >
                    {formatDollarSigned(t.pnl, 0)}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <span
                      className={cn(
                        "inline-block w-1.5 h-1.5 rounded-full",
                        win ? "bg-emerald-400" : "bg-red-400",
                      )}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            No trades match these filters.
          </div>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[10px] font-mono px-2"
            onClick={() => goPage(safePage - 1)}
            disabled={safePage === 0}
          >
            ← Prev
          </Button>
          <div className="text-[11px] font-mono text-muted-foreground">
            Page {safePage + 1} / {totalPages}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[10px] font-mono px-2"
            onClick={() => goPage(safePage + 1)}
            disabled={safePage >= totalPages - 1}
          >
            Next →
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ v: string; l: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60">
        {label}
      </span>
      <div className="flex border border-border/60 rounded overflow-hidden">
        {options.map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange(opt.v)}
            className={cn(
              "h-6 px-2 text-[10px] font-mono uppercase tracking-wider transition",
              value === opt.v
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.l}
          </button>
        ))}
      </div>
    </div>
  );
}
