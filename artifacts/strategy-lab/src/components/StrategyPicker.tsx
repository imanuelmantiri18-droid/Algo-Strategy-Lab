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
  smc: "SMC",
  trend: "TREND",
  mean_reversion: "MEAN-REV",
  breakout: "BREAKOUT",
  orderflow: "ORDER FLOW",
  advanced: "ADVANCED",
};

const categoryDescription: Record<StrategyMeta["category"], string> = {
  smc: "Smart Money Concepts — order blocks, liquidity sweeps, FVGs",
  trend: "Trend following — ride directional moves",
  mean_reversion: "Mean reversion — fade extremes back to value",
  breakout: "Breakout & volatility expansion",
  orderflow: "Order flow & market microstructure",
  advanced: "Advanced models — HMM, ARIMA, ML",
};

const categoryOrder: StrategyMeta["category"][] = [
  "smc",
  "trend",
  "mean_reversion",
  "breakout",
  "orderflow",
  "advanced",
];

type Props = {
  strategies: StrategyMeta[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function StrategyPicker({ strategies, selectedId, onSelect }: Props) {
  const grouped = categoryOrder
    .map((cat) => ({
      cat,
      items: strategies.filter((s) => s.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {grouped.map(({ cat, items }) => (
        <div key={cat} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 px-0.5">
            <div className="text-[10px] uppercase tracking-[0.25em] text-primary font-mono font-bold">
              {categoryLabel[cat]}
              <span className="ml-2 text-muted-foreground/60 font-normal">
                ({items.length})
              </span>
            </div>
            <div className="text-[9px] text-muted-foreground/70 font-mono truncate">
              {categoryDescription[cat]}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {items.map((s) => {
              const active = s.id === selectedId;
              const disabled = s.available === false;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => !disabled && onSelect(s.id)}
                  disabled={disabled}
                  data-active={active}
                  title={disabled ? s.unavailableReason ?? "Unavailable" : s.description}
                  className={cn(
                    "text-left rounded-lg border p-3 transition flex flex-col gap-1.5",
                    !disabled && "hover-elevate active-elevate-2 cursor-pointer",
                    disabled && "opacity-40 cursor-not-allowed",
                    active
                      ? "border-primary/60 bg-primary/10 glow-primary"
                      : "border-card-border bg-card/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm leading-tight truncate">
                      {s.name}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("text-[9px] shrink-0", riskStyles[s.risk])}
                    >
                      {s.risk.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                    {s.tagline}
                  </div>
                  {disabled ? (
                    <div className="text-[9px] uppercase tracking-wider text-amber-400/80 font-mono">
                      ⚠ {s.unavailableReason ?? "Unavailable"}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
