import type { StrategyMeta } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const riskStyles: Record<StrategyMeta["risk"], string> = {
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  medium: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
  high: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  extreme: "bg-red-500/20 text-red-200 border-red-500/50",
};

const categoryLabel: Record<StrategyMeta["category"], string> = {
  trend: "TREND",
  mean_reversion: "MEAN-REV",
  breakout: "BREAKOUT",
  momentum: "MOMENTUM",
  moonshot: "MOONSHOT",
};

type Props = {
  strategies: StrategyMeta[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function StrategyPicker({ strategies, selectedId, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {strategies.map((s) => {
        const active = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            data-active={active}
            className={cn(
              "text-left rounded-lg border p-3 transition flex flex-col gap-1.5 hover-elevate active-elevate-2",
              active
                ? "border-primary/60 bg-primary/10 glow-primary"
                : "border-card-border bg-card/60",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-sm leading-tight truncate">{s.name}</div>
              <Badge variant="outline" className={cn("text-[9px] shrink-0", riskStyles[s.risk])}>
                {s.risk.toUpperCase()}
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground leading-snug">{s.tagline}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-mono">
                {categoryLabel[s.category]}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
