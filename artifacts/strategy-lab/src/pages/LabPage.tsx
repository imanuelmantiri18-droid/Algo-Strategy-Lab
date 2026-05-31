import { useEffect, useMemo } from "react";
import {
  useListStrategies,
  useRunBacktest,
  type StrategyMeta,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StrategyPicker } from "@/components/StrategyPicker";
import {
  deriveConfigSummary,
  type LabConfig,
} from "@/components/LabControls";
import { LoadingPanel } from "@/components/LoadingPanel";
import { MetricsGrid } from "@/components/MetricsGrid";
import { EquityChart } from "@/components/EquityChart";
import { TradesSummary } from "@/components/TradesSummary";
import { TradesTable } from "@/components/TradesTable";
import { MonthlyReturnsHeatmap } from "@/components/MonthlyReturnsHeatmap";

type Props = {
  config: LabConfig;
  paramValues: Record<string, number>;
  onParamsChange: (next: Record<string, number>) => void;
  selectedStrategyId: string;
  onSelectedStrategyIdChange: (id: string) => void;
};

export function LabPage({
  config,
  paramValues,
  onParamsChange,
  selectedStrategyId,
  onSelectedStrategyIdChange,
}: Props) {
  const stratsQ = useListStrategies();
  const strategies: StrategyMeta[] = stratsQ.data?.strategies ?? [];
  const availableStrategies = strategies.filter((s) => s.available !== false);
  const summary = useMemo(() => deriveConfigSummary(config), [config]);
  const strategy: StrategyMeta | undefined =
    strategies.find((s) => s.id === selectedStrategyId) ?? availableStrategies[0];
  const runM = useRunBacktest();

  useEffect(() => {
    if (!selectedStrategyId && availableStrategies.length > 0) {
      // Default to the tournament champion so the first-time user lands on
      // the strategy we recommend.
      const champion = availableStrategies.find(
        (s) => s.id === "fractal_breakout",
      );
      onSelectedStrategyIdChange((champion ?? availableStrategies[0]!).id);
    }
  }, [selectedStrategyId, availableStrategies, onSelectedStrategyIdChange]);

  // Reset params (use defaults) when the strategy changes
  useEffect(() => {
    if (!strategy) return;
    const next: Record<string, number> = {};
    for (const p of strategy.params) next[p.key] = p.default;
    onParamsChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy?.id]);

  const isLoading = runM.isPending;
  const result = runM.data;

  const onRun = () => {
    if (!strategy) return;
    runM.mutate({
      data: {
        strategyId: strategy.id,
        params: paramValues,
        interval: config.interval,
        lookbackDays: config.lookbackDays,
        initialCapital: config.initialCapital,
        walkForwardSplitDate: config.walkForwardSplitDate,
        risk: config.risk,
        dataSource: config.dataSource,
        symbol: config.symbol,
      },
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
      <div className="lg:col-span-4 space-y-3 order-2 lg:order-1">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Strategies</span>
              <Badge variant="outline" className="font-mono text-[9px]">
                {availableStrategies.length} / {strategies.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-4 pt-0 max-h-[520px] overflow-y-auto">
            {stratsQ.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : (
              <StrategyPicker
                strategies={strategies}
                selectedId={strategy?.id ?? ""}
                onSelect={onSelectedStrategyIdChange}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-8 space-y-3 order-1 lg:order-2 min-w-0">
        {/* Header card with strategy info + Run */}
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Selected strategy
                </div>
                <div className="text-base sm:text-lg font-semibold leading-tight">
                  {strategy?.name ?? "Loading…"}
                </div>
                {strategy ? (
                  <p className="text-xs text-muted-foreground leading-snug mt-1">
                    {strategy.description}
                  </p>
                ) : null}
              </div>
              <Button
                onClick={onRun}
                disabled={isLoading || !strategy}
                size="lg"
                className="font-mono uppercase tracking-wider sm:w-44 shrink-0"
              >
                {isLoading ? "Running…" : "Run Backtest"}
              </Button>
            </div>
            <Separator />
            <div className="text-[10px] font-mono text-muted-foreground/80 leading-snug">
              <span className="text-muted-foreground uppercase tracking-wider">Active config:</span>{" "}
              {summary.periodLabel} · {summary.intervalLabel} ·{" "}
              {summary.splitLabel} · {summary.riskLabel} ·{" "}
              {summary.capitalLabel}
            </div>
          </CardContent>
        </Card>

        <LoadingPanel
          active={isLoading}
          title={`Backtesting ${strategy?.name ?? "strategy"}`}
          subtitle={`${summary.intervalLabel} · ${summary.periodLabel}`}
          steps={[
            config.dataSource === "hyperliquid"
              ? `Fetching ${config.symbol ?? "HYPE"}/USDC klines from Hyperliquid…`
              : "Fetching real BTC/USDT klines from Binance…",
            "Computing indicators…",
            "Generating signals…",
            "Walking trades through in-sample period…",
            "Forward-testing on out-of-sample period…",
            "Computing Sharpe, Sortino, drawdown, robustness…",
          ]}
        />

        {runM.isError ? (
          <Card className="border-destructive/50">
            <CardContent className="p-4 text-sm text-red-300">
              Backtest failed: {(runM.error as Error)?.message ?? "unknown error"}
            </CardContent>
          </Card>
        ) : null}

        {!isLoading && !result ? (
          <Card>
            <CardContent className="p-6 sm:p-10 text-center scan-grid">
              <div className="text-sm text-muted-foreground font-mono uppercase tracking-wider">
                Awaiting Run
              </div>
              <div className="mt-2 text-base sm:text-lg">
                Pick a strategy and tap <span className="text-primary">Run Backtest</span>.
              </div>
              <div className="mt-3 text-[10px] text-muted-foreground/70 font-mono">
                Try the <span className="text-primary">Tournament</span> tab to compare all 46 algorithms at once.
              </div>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <>
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Results
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <MetricsGrid
                  metrics={result.metrics}
                  initialCapital={result.request.initialCapital}
                  walkForward={result.walkForward}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Equity Curve
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-4 pt-0">
                <EquityChart
                  series={[
                    {
                      name: result.strategyId,
                      color: "hsl(152 90% 48%)",
                      data: result.equityCurve,
                    },
                  ]}
                  height={240}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Drawdown
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-4 pt-0">
                <EquityChart
                  variant="drawdown"
                  series={[
                    {
                      name: result.strategyId,
                      color: "hsl(0 78% 58%)",
                      data: result.equityCurve,
                    },
                  ]}
                  height={180}
                />
              </CardContent>
            </Card>

            <MonthlyReturnsHeatmap
              equityCurve={result.equityCurve}
              splitDate={result.walkForward.splitDate}
            />

            <TradesSummary trades={result.trades} />

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Trade Log</span>
                  <span className="text-[10px] text-muted-foreground/70">
                    {result.trades.length} total
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-4 pb-4 pt-0">
                <TradesTable trades={result.trades} />
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
