import { useMemo } from "react";
import { type TournamentRow } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LoadingPanel } from "@/components/LoadingPanel";
import {
  FIXED_CONFIG_SUMMARY,
  deriveConfigSummary,
  type LabConfig,
} from "@/components/LabControls";
import { useTournamentStream } from "@/hooks/useTournamentStream";
import {
  formatPercent,
  formatNumber,
  formatDollar,
  getVerdictColor,
  type Verdict,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const categoryLabel: Record<string, string> = {
  smc: "SMC",
  trend: "TREND",
  mean_reversion: "MEAN-REV",
  breakout: "BREAKOUT",
  orderflow: "ORDER FLOW",
  advanced: "ADVANCED",
};

type Props = {
  baseConfig: LabConfig;
  onApply: (strategyId: string) => void;
};

export function TournamentPage({ baseConfig, onApply }: Props) {
  const runM = useTournamentStream();
  const summary = useMemo(() => deriveConfigSummary(baseConfig), [baseConfig]);

  const onRun = () => {
    runM.start({
      interval: baseConfig.interval,
      lookbackDays: baseConfig.lookbackDays,
      initialCapital: baseConfig.initialCapital,
      risk: baseConfig.risk,
      walkForwardSplitDate: baseConfig.walkForwardSplitDate,
      maxDrawdownFilterPct: FIXED_CONFIG_SUMMARY.ddFilterPct,
      dataSource: baseConfig.dataSource,
      symbol: baseConfig.symbol,
    });
  };

  const result = runM.data
    ? runM.data
    : runM.liveRows.length > 0
      ? {
          rows: runM.liveRows,
          best: undefined as TournamentRow | undefined,
          totalStrategies: runM.progress?.total ?? runM.liveRows.length,
          kept: runM.liveRows.filter((r) => !r.filtered).length,
          dropped: runM.liveRows.filter((r) => r.filtered).length,
          drawdownFilterPct: FIXED_CONFIG_SUMMARY.ddFilterPct,
          splitDate: baseConfig.walkForwardSplitDate ?? "",
        }
      : null;

  // Top kept rows ranked by robustness × OOS APY (the same logic the API uses
  // to pick its champion). Keep the leaderboard short (top 10) so it stays
  // skimmable.
  const topRows = useMemo<TournamentRow[]>(() => {
    if (!result) return [];
    const kept = result.rows.filter((r: TournamentRow) => !r.filtered && !r.error);
    kept.sort(
      (a: TournamentRow, b: TournamentRow) =>
        (b.robustnessScore ?? 0) - (a.robustnessScore ?? 0) ||
        (b.outOfSample.annualReturnPct ?? 0) -
          (a.outOfSample.annualReturnPct ?? 0),
    );
    return kept.slice(0, 10);
  }, [result]);

  return (
    <div className="space-y-4">
      {/* Run card */}
      <Card>
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <div className="space-y-1 min-w-0">
            <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Tournament · 46 strategies
            </div>
            <div className="text-base sm:text-lg font-semibold leading-tight">
              Find the best algorithm on BTC since 2022
            </div>
            <div className="text-[11px] text-muted-foreground font-mono leading-snug">
              {summary.periodLabel} · {summary.intervalLabel} · {summary.splitLabel} · {summary.riskLabel} · DD filter ≤ {summary.ddFilterPct}%
            </div>
          </div>
          <Button
            onClick={onRun}
            disabled={runM.isPending}
            size="lg"
            className="font-mono uppercase tracking-wider sm:w-56 shrink-0"
          >
            {runM.isPending ? "Running…" : "Run Tournament"}
          </Button>
        </CardContent>
      </Card>

      {/* Progress / loading */}
      <LoadingPanel
        active={runM.isPending && !runM.progress}
        title="Running tournament"
        subtitle="Fetching real BTC/USDT history from Binance…"
        steps={[
          "Fetching real BTC/USDT klines from Binance…",
          "Computing indicators across the full library…",
          "Running every strategy on the in-sample window…",
          "Forward-testing each on the out-of-sample window…",
          "Filtering by max drawdown…",
          "Scoring robustness and ranking…",
        ]}
      />

      {runM.isPending && runM.progress && runM.progress.total > 0 ? (
        <Card className="border-primary/40">
          <CardContent className="p-3 sm:p-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <span>{runM.status ?? "Working…"}</span>
              <span className="text-primary">
                {runM.progress.done} / {runM.progress.total}
              </span>
            </div>
            <Progress
              value={(runM.progress.done / runM.progress.total) * 100}
              className="h-1.5"
            />
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground/80">
              <span>
                {runM.progress.rate > 0
                  ? `${runM.progress.rate.toFixed(2)} strat/s`
                  : "warming up…"}
              </span>
              <span>
                {runM.progress.etaMs > 0
                  ? `eta ${Math.max(1, Math.round(runM.progress.etaMs / 1000))}s`
                  : "—"}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full font-mono uppercase tracking-wider text-[10px] h-7"
              onClick={runM.cancel}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {runM.isError ? (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-sm text-red-300">
            Tournament failed: {(runM.error as Error)?.message ?? "unknown error"}
          </CardContent>
        </Card>
      ) : null}

      {!runM.isPending && !result ? (
        <Card>
          <CardContent className="p-6 sm:p-10 text-center scan-grid">
            <div className="text-sm text-muted-foreground font-mono uppercase tracking-wider">
              Awaiting Run
            </div>
            <div className="mt-2 text-base sm:text-lg">
              Tap <span className="text-primary">Run Tournament</span> to backtest all 46 algorithms.
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Takes ~60-90 seconds. Champion is picked by robustness across train/test.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Champion */}
      {result && result.best ? (
        <Card className="border-primary/40 glow-primary">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-primary flex items-center justify-between">
              <span>🏆 Champion</span>
              <Badge variant="outline" className="font-mono text-[10px] border-primary/50 text-primary">
                {result.kept} kept · {result.dropped} dropped of {result.totalStrategies}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <BestRow
              row={result.best}
              onApply={onApply}
              initialCapital={baseConfig.initialCapital}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Top 10 leaderboard */}
      {result ? (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Top {topRows.length}</span>
              <span className="text-[10px] text-muted-foreground/70">ranked by robustness</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-4 pt-0">
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[11px] font-mono">
                <thead className="text-muted-foreground/70 uppercase tracking-wider">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-1.5 px-2">#</th>
                    <th className="text-left py-1.5 px-2">Strategy</th>
                    <th className="text-right py-1.5 px-2">OOS APY</th>
                    <th className="text-right py-1.5 px-2">DD</th>
                    <th className="text-right py-1.5 px-2">Sharpe</th>
                    <th className="text-right py-1.5 px-2">Win%</th>
                    <th className="text-right py-1.5 px-2">Trades</th>
                    <th className="text-right py-1.5 px-2">Robust</th>
                    <th className="text-right py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {topRows.map((r, i) => (
                    <Row
                      key={r.strategyId}
                      rank={i + 1}
                      row={r}
                      onApply={onApply}
                    />
                  ))}
                </tbody>
              </table>
              {topRows.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-6">
                  No strategy passed the {FIXED_CONFIG_SUMMARY.ddFilterPct}% drawdown filter.
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({
  rank,
  row,
  onApply,
}: {
  rank: number;
  row: TournamentRow;
  onApply: (strategyId: string) => void;
}) {
  const oos = row.outOfSample;
  const apyColor =
    oos.annualReturnPct > 50
      ? "text-emerald-300"
      : oos.annualReturnPct > 0
        ? "text-cyan-300"
        : "text-red-300";
  return (
    <tr className="border-b border-border/30 hover:bg-card/40">
      <td className="py-1.5 px-2 text-muted-foreground">{rank}</td>
      <td className="py-1.5 px-2">
        <div className="font-semibold text-[12px] truncate max-w-[180px]">{row.strategyName}</div>
        <div className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
          {categoryLabel[row.category] ?? row.category}
        </div>
      </td>
      <td className={cn("py-1.5 px-2 text-right", apyColor)}>
        {formatPercent(oos.annualReturnPct, 1)}
      </td>
      <td className="py-1.5 px-2 text-right text-red-300/80">
        {formatPercent(oos.maxDrawdownPct, 1)}
      </td>
      <td className="py-1.5 px-2 text-right">{formatNumber(oos.sharpe, 2)}</td>
      <td className="py-1.5 px-2 text-right">{formatNumber(oos.winRate, 1)}</td>
      <td className="py-1.5 px-2 text-right text-muted-foreground">{oos.trades}</td>
      <td className="py-1.5 px-2 text-right">
        <span className="text-primary">{formatNumber(row.robustnessScore, 2)}</span>
      </td>
      <td className="py-1.5 px-2 text-right whitespace-nowrap">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] font-mono px-2"
          onClick={() => onApply(row.strategyId)}
          title="Open this strategy in single-backtest view"
        >
          Detail →
        </Button>
      </td>
    </tr>
  );
}

function BestRow({
  row,
  onApply,
  initialCapital,
}: {
  row: TournamentRow;
  onApply: (id: string) => void;
  initialCapital: number;
}) {
  const oos = row.outOfSample;
  const verdict = (oos.verdict ?? "mediocre") as Verdict;
  const finalEquity = oos.finalEquity ?? initialCapital;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight">{row.strategyName}</div>
          <div className="text-[10px] text-muted-foreground/80 uppercase tracking-[0.2em] font-mono">
            {categoryLabel[row.category] ?? row.category} · robustness {formatNumber(row.robustnessScore, 2)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("font-mono text-[10px]", getVerdictColor(verdict))}>
            {verdict.toUpperCase()}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] font-mono uppercase tracking-wider"
            onClick={() => onApply(row.strategyId)}
          >
            Open Detail →
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="OOS APY" value={formatPercent(oos.annualReturnPct, 1)} accent="primary" />
        <Stat label="OOS Total" value={formatPercent(oos.totalReturnPct, 1)} />
        <Stat label="Max DD" value={formatPercent(oos.maxDrawdownPct, 1)} accent="danger" />
        <Stat label="Sharpe" value={formatNumber(oos.sharpe, 2)} />
        <Stat label="Win Rate" value={`${formatNumber(oos.winRate, 1)}%`} />
        <Stat label="Profit Factor" value={formatNumber(oos.profitFactor, 2)} />
        <Stat label="Trades (OOS)" value={String(oos.trades)} />
        <Stat label="Final Equity" value={formatDollar(finalEquity, 0)} accent="primary" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "primary" | "danger";
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2">
      <div className="text-[10px] text-muted-foreground/70 font-mono uppercase tracking-wider">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-mono font-semibold mt-0.5",
          accent === "primary" && "text-primary",
          accent === "danger" && "text-red-300",
        )}
      >
        {value}
      </div>
    </div>
  );
}
