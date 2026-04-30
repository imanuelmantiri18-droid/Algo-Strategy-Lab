import { useEffect, useMemo } from "react";
import {
  useListStrategies,
  useRunBacktest,
  type StrategyMeta,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StrategyPicker } from "@/components/StrategyPicker";
import { StrategyParams } from "@/components/StrategyParams";
import {
  LabControls,
  DEFAULT_CONFIG,
  type LabConfig,
} from "@/components/LabControls";
import { LoadingPanel } from "@/components/LoadingPanel";
import { MetricsGrid } from "@/components/MetricsGrid";
import { EquityChart } from "@/components/EquityChart";
import { PriceChart } from "@/components/PriceChart";
import { TradesTable } from "@/components/TradesTable";
import { exportBacktestJson, exportTradesCsv } from "@/lib/exportResults";

type Props = {
  config: LabConfig;
  onConfigChange: (next: LabConfig) => void;
  paramValues: Record<string, number>;
  onParamsChange: (next: Record<string, number>) => void;
  selectedStrategyId: string;
  onSelectedStrategyIdChange: (id: string) => void;
};

export function LabPage({
  config,
  onConfigChange,
  paramValues,
  onParamsChange,
  selectedStrategyId,
  onSelectedStrategyIdChange,
}: Props) {
  const stratsQ = useListStrategies();
  const strategies: StrategyMeta[] = stratsQ.data?.strategies ?? [];
  const availableStrategies = strategies.filter((s) => s.available !== false);
  const strategy: StrategyMeta | undefined =
    strategies.find((s) => s.id === selectedStrategyId) ?? availableStrategies[0];
  const runM = useRunBacktest();

  // Auto-select first available strategy on load
  useEffect(() => {
    if (!selectedStrategyId && availableStrategies.length > 0) {
      onSelectedStrategyIdChange(availableStrategies[0]!.id);
    }
  }, [selectedStrategyId, availableStrategies, onSelectedStrategyIdChange]);

  // Reset params whenever the selected strategy changes
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
        ...(config.useDateSplit
          ? { walkForwardSplitDate: config.walkForwardSplitDate }
          : { walkForwardSplit: config.walkForwardSplit }),
        risk: config.risk,
      },
    });
  };

  const subtitleParts = useMemo(
    () => [
      `${config.risk.leverage}x lev`,
      `${config.interval} candles`,
      `${config.lookbackDays}d`,
      `ATR×${config.risk.atrMultiplierSL} · 1:${config.risk.riskRewardRatio}`,
    ],
    [config],
  );

  const splitLabel = config.useDateSplit
    ? `train < ${config.walkForwardSplitDate} · test ≥ ${config.walkForwardSplitDate}`
    : `${Math.round(config.walkForwardSplit * 100)}% in / ${Math.round((1 - config.walkForwardSplit) * 100)}% out`;

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
          <CardContent className="px-3 pb-4 pt-0 max-h-[480px] overflow-y-auto">
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

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              {strategy?.name ?? "Strategy"}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {strategy ? (
              <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
                {strategy.description}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <Tabs defaultValue="risk" className="w-full">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="risk">Market &amp; Risk</TabsTrigger>
                <TabsTrigger value="params">Strategy</TabsTrigger>
              </TabsList>
              <TabsContent value="risk" className="pt-4">
                <LabControls config={config} onChange={onConfigChange} />
              </TabsContent>
              <TabsContent value="params" className="pt-4">
                {strategy ? (
                  <StrategyParams
                    params={strategy.params}
                    values={paramValues}
                    onChange={(k, v) =>
                      onParamsChange({ ...paramValues, [k]: v })
                    }
                  />
                ) : null}
              </TabsContent>
            </Tabs>

            <Separator className="my-4" />

            <Button
              onClick={onRun}
              disabled={isLoading || !strategy}
              className="w-full font-mono uppercase tracking-wider"
              size="lg"
            >
              {isLoading ? "Running Backtest…" : "Run Backtest"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onConfigChange(DEFAULT_CONFIG);
                if (strategy) {
                  const next: Record<string, number> = {};
                  for (const p of strategy.params) next[p.key] = p.default;
                  onParamsChange(next);
                }
              }}
              className="w-full mt-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
            >
              Reset to defaults
            </Button>
            <p className="text-[10px] text-amber-300/70 mt-3 leading-snug">
              Real BTC/USDT data from Binance public API. Leveraged trading
              carries serious liquidation risk — research only.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-8 space-y-3 order-1 lg:order-2 min-w-0">
        <LoadingPanel
          active={isLoading}
          title={`Backtesting ${strategy?.name ?? "strategy"}`}
          subtitle={subtitleParts.join(" · ")}
          steps={[
            `Fetching real BTC/USDT ${config.interval} klines from Binance…`,
            `Aligning ${config.lookbackDays} days of price history…`,
            "Computing indicators…",
            "Generating long/short signals…",
            `Walking trades through in-sample period (${splitLabel})…`,
            `Forward-testing on out-of-sample period…`,
            "Applying ATR stop loss, R:R take profit, fees, slippage…",
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
                Pick a strategy from the {availableStrategies.length}-algo library and run on real BTC history.
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Default: $1,000 · 5× · 4h · {config.lookbackDays}d · {splitLabel}.
              </div>
              <div className="mt-3 text-[10px] text-muted-foreground/70 font-mono">
                Try the <span className="text-primary">Tournament</span> tab to find the best algorithm across all strategies.
              </div>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <>
            <Card>
              <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0 gap-2">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Results
                </CardTitle>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {result.request.interval}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {result.request.risk.leverage}x
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    1:{result.request.risk.riskRewardRatio}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => exportBacktestJson(result)}
                    className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider"
                    title="Download full backtest result as JSON"
                  >
                    Export JSON
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => exportTradesCsv(result)}
                    className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider"
                    title="Download trade log as CSV"
                    disabled={result.trades.length === 0}
                  >
                    Export CSV
                  </Button>
                </div>
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

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Price &amp; Trade Entries
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-4 pt-0">
                <PriceChart candles={result.candles} trades={result.trades} height={240} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Trades ({result.trades.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-4 pt-0">
                <TradesTable trades={result.trades} />
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
