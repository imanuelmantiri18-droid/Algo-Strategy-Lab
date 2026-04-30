import type { BacktestMetrics } from "@workspace/api-client-react";
import { MetricCard } from "@/components/MetricCard";
import { Badge } from "@/components/ui/badge";
import {
  formatDollar,
  formatNumber,
  formatPercent,
  getVerdictColor,
  type Verdict,
} from "@/lib/format";

type Props = {
  metrics: BacktestMetrics;
  initialCapital: number;
};

export function MetricsGrid({ metrics, initialCapital }: Props) {
  const annualTone =
    metrics.annualReturnPct >= 200
      ? "positive"
      : metrics.annualReturnPct >= 0
        ? "default"
        : "negative";
  const totalTone =
    metrics.totalReturnPct >= 0 ? ("positive" as const) : ("negative" as const);

  return (
    <div className="space-y-3">
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
          <Badge variant="outline" className="font-mono text-[10px] bg-red-500/15 text-red-300 border-red-500/40">
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
          tone={metrics.profitFactor >= 1.5 ? "positive" : metrics.profitFactor >= 1 ? "default" : "negative"}
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
    </div>
  );
}
