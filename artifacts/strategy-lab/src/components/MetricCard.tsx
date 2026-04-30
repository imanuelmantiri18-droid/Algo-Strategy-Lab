import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "positive" | "negative" | "warn" | "accent";
  className?: string;
};

const toneStyles: Record<NonNullable<Props["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-emerald-300",
  negative: "text-red-300",
  warn: "text-amber-300",
  accent: "text-fuchsia-300",
};

export function MetricCard({ label, value, hint, tone = "default", className }: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border border-card-border bg-card/70 backdrop-blur p-3 sm:p-4 flex flex-col gap-1 min-w-0",
        className,
      )}
    >
      <div className="text-[10px] sm:text-xs uppercase tracking-[0.16em] text-muted-foreground font-mono truncate">
        {label}
      </div>
      <div className={cn("text-lg sm:text-2xl font-semibold font-mono leading-tight", toneStyles[tone])}>
        {value}
      </div>
      {hint ? (
        <div className="text-[10px] sm:text-xs text-muted-foreground font-mono">{hint}</div>
      ) : null}
    </div>
  );
}
