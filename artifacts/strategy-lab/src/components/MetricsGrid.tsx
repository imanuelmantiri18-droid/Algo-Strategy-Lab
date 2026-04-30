import type {
  BacktestMetrics,
  WalkForwardSummary,
} from "@workspace/api-client-react";
import { MetricCard } from "@/components/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  formatDateTime,
  formatDollar,
  formatNumber,
  formatPercent,
  getVerdictColor,
  type Verdict,
} from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  metrics: BacktestMetrics;
  initialCapital: number;
  walkForward?: WalkForwardSummary;
};

export function MetricsGrid({ metrics, initialCapital, walkForward }: Props) {
  const annualTone =
    metrics.annualReturnPct >= 200
      ? "positive"
      : metrics.annualReturnPct >= 0
        ? "default"
        : "negative";
  const totalTone =
    metrics.totalReturnPct >= 0 ? ("positive" as const) : ("negative" as const);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`uppercase tracking-wider font-mono text-[10px] ${getVerdictColor(
            metrics.verdict as Verdict,
          )}`}
        >
          {metrics.verdict}
        </Badge>
        <Badge variant="outline" className="font-mono text-[10px]">
          {metrics.trades} trades
        </Badge>
        {metrics.liquidations > 0 ? (
          <Badge
            variant="outline"
            className="font-mono text-[10px] bg-red-500/15 text-red-300 border-red-500/40"
          >
            {metrics.liquidations} LIQ
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <MetricCard
          label="Annual Return"
          value={formatPercent(metrics.annualReturnPct)}
          tone={annualTone}
          hint={`${formatPercent(metrics.totalReturnPct)} total`}
        />
        <MetricCard
          label="Final Equity"
          value={formatDollar(metrics.finalEquity)}
          tone={totalTone}
          hint={`from ${formatDollar(initialCapital)}`}
        />
        <MetricCard
          label="Max Drawdown"
          value={formatPercent(metrics.maxDrawdownPct)}
          tone="negative"
          hint="peak to trough"
        />
        <MetricCard
          label="Sharpe"
          value={formatNumber(metrics.sharpe, 2)}
          tone={metrics.sharpe >= 1 ? "positive" : "default"}
          hint={`Sortino ${formatNumber(metrics.sortino, 2)}`}
        />
        <MetricCard
          label="Win Rate"
          value={`${formatNumber(metrics.winRate, 1)}%`}
          tone={metrics.winRate >= 50 ? "positive" : "warn"}
          hint={`${metrics.wins}W · ${metrics.losses}L`}
        />
        <MetricCard
          label="Profit Factor"
          value={formatNumber(metrics.profitFactor, 2)}
          tone={
            metrics.profitFactor >= 1.5
              ? "positive"
              : metrics.profitFactor >= 1
                ? "default"
                : "negative"
          }
          hint="gross win / loss"
        />
        <MetricCard
          label="Avg Win"
          value={formatPercent(metrics.avgWinPct)}
          tone="positive"
          hint="per trade"
        />
        <MetricCard
          label="Avg Loss"
          value={formatPercent(metrics.avgLossPct)}
          tone="negative"
          hint="per trade"
        />
      </div>

      {walkForward ? (
        <>
          <Separator />
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Walk-Forward Validation
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px]",
                  walkForward.robustnessScore >= 0.7
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                    : walkForward.robustnessScore >= 0.3
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                      : "bg-red-500/15 text-red-300 border-red-500/40",
                )}
              >
                Robustness {formatNumber(walkForward.robustnessScore, 2)}
              </Badge>
            </div>
            <div className="text-[10px] text-muted-foreground/80 font-mono mb-3">
              Split at {formatDateTime(walkForward.splitDate)} · OOS APY ÷ IS APY
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <SamplePanel label="In-Sample (training)" m={walkForward.inSample} />
              <SamplePanel label="Out-of-Sample (forward)" m={walkForward.outOfSample} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function SamplePanel({ label, m }: { label: string; m: BacktestMetrics }) {
  return (
    <div className="rounded-lg border border-card-border bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <Badge
          variant="outline"
          className={cn(
            "font-mono text-[9px] uppercase",
            getVerdictColor(m.verdict as Verdict),
          )}
        >
          {m.verdict}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
        <div className="text-muted-foreground">APY</div>
        <div
          className={cn(
            "text-right",
            m.annualReturnPct >= 0 ? "text-emerald-300" : "text-red-300",
          )}
        >
          {formatPercent(m.annualReturnPct)}
        </div>
        <div className="text-muted-foreground">Max DD</div>
        <div className="text-right text-red-300">
          {formatPercent(m.maxDrawdownPct)}
        </div>
        <div className="text-muted-foreground">Sharpe</div>
        <div className="text-right">{formatNumber(m.sharpe, 2)}</div>
        <div className="text-muted-foreground">Trades</div>
        <div className="text-right">{m.trades}</div>
        <div className="text-muted-foreground">Win%</div>
        <div className="text-right">{formatNumber(m.winRate, 0)}%</div>
        <div className="text-muted-foreground">Final</div>
        <div className="text-right">{formatDollar(m.finalEquity)}</div>
      </div>
    </div>
  );
}
