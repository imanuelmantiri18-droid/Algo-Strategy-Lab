import { useEffect, useMemo, useState } from "react";
import {
  useListStrategies,
  useRunBacktest,
  useGetBtcData,
  type StrategyMeta,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StrategyPicker } from "@/components/StrategyPicker";
import { StrategyParams } from "@/components/StrategyParams";
import { RiskControls, type RiskValues } from "@/components/RiskControls";
import { LoadingPanel } from "@/components/LoadingPanel";
import { MetricsGrid } from "@/components/MetricsGrid";
import { EquityChart } from "@/components/EquityChart";
import { PriceChart } from "@/components/PriceChart";
import { TradesTable } from "@/components/TradesTable";
import { formatDollar } from "@/lib/format";

const DEFAULT_RISK: RiskValues = {
  leverage: 5,
  stopLossPct: 4,
  takeProfitPct: 18,
  days: 730,
  initialCapital: 10_000,
};

export function LabPage({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const stratsQ = useListStrategies();
  const strategies: StrategyMeta[] = stratsQ.data?.strategies ?? [];
  const selected = strategies.find((s) => s.id === selectedId) ?? strategies[0];
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [risk, setRisk] = useState<RiskValues>(DEFAULT_RISK);

  useEffect(() => {
    if (!selected) return;
    const next: Record<string, number> = {};
    for (const p of selected.params) next[p.key] = p.default;
    setParamValues(next);
    if (selected.id === "moonshot") {
      setRisk((r) => ({ ...r, leverage: 15, stopLossPct: 2.5, takeProfitPct: 35 }));
    }
  }, [selected?.id]);

  const btcQ = useGetBtcData({ days: risk.days });
  const runM = useRunBacktest();

  const isLoading = runM.isPending;
  const result = runM.data;

  const onRun = () => {
    if (!selected) return;
    runM.mutate({
      data: {
        strategyId: selected.id,
        params: paramValues,
        leverage: risk.leverage,
        stopLossPct: risk.stopLossPct,
        takeProfitPct: risk.takeProfitPct,
        days: risk.days,
        initialCapital: risk.initialCapital,
        feePct: 0.06,
      },
    });
  };

  const lastPrice = btcQ.data?.candles?.[btcQ.data.candles.length - 1]?.c;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
      <div className="lg:col-span-4 space-y-3 order-2 lg:order-1">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Strategy
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-3">
            {stratsQ.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading strategies…</div>
            ) : (
              <StrategyPicker
                strategies={strategies}
                selectedId={selected?.id ?? ""}
                onSelect={onSelect}
              />
            )}
            {selected ? (
              <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
                {selected.description}
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
                <TabsTrigger value="risk">Risk</TabsTrigger>
                <TabsTrigger value="params">Params</TabsTrigger>
              </TabsList>
              <TabsContent value="risk" className="pt-4">
                <RiskControls values={risk} onChange={setRisk} />
              </TabsContent>
              <TabsContent value="params" className="pt-4">
                {selected ? (
                  <StrategyParams
                    params={selected.params}
                    values={paramValues}
                    onChange={(k, v) => setParamValues((s) => ({ ...s, [k]: v }))}
                  />
                ) : null}
              </TabsContent>
            </Tabs>

            <Separator className="my-4" />

            <Button
              onClick={onRun}
              disabled={isLoading || !selected}
              className="w-full font-mono uppercase tracking-wider"
              size="lg"
            >
              {isLoading ? "Running Backtest…" : "Run Backtest"}
            </Button>
            {selected?.risk === "extreme" ? (
              <p className="text-[10px] text-red-300/80 mt-2 leading-snug">
                Extreme risk: full account loss possible. For research only — not financial advice.
              </p>
            ) : null}
            {lastPrice ? (
              <div className="text-[10px] text-muted-foreground font-mono mt-3 flex items-center justify-between">
                <span>BTC last close</span>
                <span className="text-cyan-300">{formatDollar(lastPrice)}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-8 space-y-3 order-1 lg:order-2 min-w-0">
        <LoadingPanel
          active={isLoading}
          title={`Running ${selected?.name ?? "strategy"}`}
          subtitle={`${risk.leverage}x leverage · SL ${risk.stopLossPct}% · TP ${risk.takeProfitPct}% · ${risk.days}d`}
          steps={[
            "Fetching historical candles…",
            "Computing strategy signals…",
            "Walking trades day by day…",
            "Applying SL / TP / liquidation rules…",
            "Computing Sharpe, Sortino, drawdown…",
            "Building equity curve…",
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
                Pick a strategy, dial in leverage, SL, and TP — then run the engine.
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Try the <span className="text-primary">Moonshot</span> preset to chase ~1000% APY (and the drawdown that comes with it).
              </div>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <>
            <Card>
              <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Results
                </CardTitle>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {result.request.strategyId} · {result.request.leverage}x
                </Badge>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <MetricsGrid
                  metrics={result.metrics}
                  initialCapital={result.request.initialCapital}
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
