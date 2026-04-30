import type { Trade } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDate, formatDollar, formatDollarSigned, formatPercent } from "@/lib/format";
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
};

const reasonLabel: Record<Trade["exitReason"], string> = {
  take_profit: "TP",
  stop_loss: "SL",
  signal_exit: "EXIT",
  end_of_data: "EOD",
  liquidation: "LIQ",
};

export function TradesTable({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-card-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        No trades were generated. Try loosening params, more days, or a different strategy.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-card-border bg-card/60 overflow-hidden">
      <ScrollArea className="h-[320px] sm:h-[400px]">
        <table className="w-full text-xs sm:text-sm font-mono">
          <thead className="sticky top-0 bg-card/95 backdrop-blur z-10">
            <tr className="text-left text-muted-foreground">
              <th className="px-2 sm:px-3 py-2 font-normal">#</th>
              <th className="px-2 sm:px-3 py-2 font-normal">Side</th>
              <th className="px-2 sm:px-3 py-2 font-normal">Entry</th>
              <th className="px-2 sm:px-3 py-2 font-normal hidden sm:table-cell">Exit</th>
              <th className="px-2 sm:px-3 py-2 font-normal text-right">Price</th>
              <th className="px-2 sm:px-3 py-2 font-normal text-right">P&amp;L%</th>
              <th className="px-2 sm:px-3 py-2 font-normal text-right">P&amp;L $</th>
              <th className="px-2 sm:px-3 py-2 font-normal text-right">Why</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => {
              const isWin = t.pnl > 0;
              return (
                <tr
                  key={i}
                  className="border-t border-border/40 hover:bg-elevate-1"
                  style={{ background: isWin ? undefined : undefined }}
                >
                  <td className="px-2 sm:px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <span
                      className={cn(
                        "uppercase text-[10px] tracking-wider",
                        t.side === "long" ? "text-emerald-300" : "text-fuchsia-300",
                      )}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                    {formatDate(t.entryTime)}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                    {formatDate(t.exitTime)}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-right whitespace-nowrap">
                    {formatDollar(t.entryPrice)}
                    <span className="text-muted-foreground"> → </span>
                    {formatDollar(t.exitPrice)}
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
                  <td className="px-2 sm:px-3 py-1.5 text-right">
                    <Badge
                      variant="outline"
                      className={cn("text-[9px] py-0 px-1.5", reasonStyles[t.exitReason])}
                    >
                      {reasonLabel[t.exitReason]}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
