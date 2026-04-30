import { useEffect, useMemo, useState } from "react";
import {
  useListStrategies,
  useRunOptimization,
  type StrategyMeta,
} from "@workspace/api-client-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StrategyPicker } from "@/components/StrategyPicker";
import { LoadingPanel } from "@/components/LoadingPanel";
import { MetricCard } from "@/components/MetricCard";
import { formatDollar, formatNumber, formatPercent, getVerdictColor } from "@/lib/format";
import { cn } from "@/lib/utils";

function parseGrid(input: string): number[] {
  return input
    .split(/[, ]+/)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const DEFAULT_LEV = "2, 5, 10, 15, 25";
const DEFAULT_SL = "1.5, 3, 5, 8";
const DEFAULT_TP = "8, 15, 30, 60";

export function OptimizerPage({
  selectedId,
  onSelect,
  onApplyBest,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApplyBest: (params: {
    strategyId: string;
    leverage: number;
    stopLossPct: number;
    takeProfitPct: number;
  }) => void;
}) {
  const stratsQ = useListStrategies();
  const strategies: StrategyMeta[] = stratsQ.data?.strategies ?? [];
  const selected = strategies.find((s) => s.id === selectedId) ?? strategies[0];

  const [days, setDays] = useState(730);
  const [capital, setCapital] = useState(10_000);
  const [levStr, setLevStr] = useState(DEFAULT_LEV);
  const [slStr, setSlStr] = useState(DEFAULT_SL);
  const [tpStr, setTpStr] = useState(DEFAULT_TP);

  const optM = useRunOptimization();
  const result = optM.data;

  useEffect(() => {
    if (selected?.id === "moonshot") {
      setLevStr("10, 15, 20, 25, 30");
      setSlStr("1.5, 2, 3, 5");
      setTpStr("20, 35, 60, 100");
    }
  }, [selected?.id]);

  const onRun = () => {
    if (!selected) return;
    const params: Record<string, number> = {};
    for (const p of selected.params) params[p.key] = p.default;
    optM.mutate({
      data: {
        strategyId: selected.id,
        params,
        days,
        initialCapital: capital,
        feePct: 0.06,
        leverageGrid: parseGrid(levStr),
        stopLossGrid: parseGrid(slStr),
        takeProfitGrid: parseGrid(tpStr),
      },
    });
  };

  const scatterData = useMemo(() => {
    if (!result) return [];
    return result.rows.map((r) => ({
      x: r.leverage,
      y: r.metrics.annualReturnPct,
      z: Math.abs(r.metrics.maxDrawdownPct) + 1,
      verdict: r.metrics.verdict,
      sl: r.stopLossPct,
      tp: r.takeProfitPct,
      dd: r.metrics.maxDrawdownPct,
    }));
  }, [result]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
      <div className="lg:col-span-4 space-y-3 order-2 lg:order-1">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Strategy
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <StrategyPicker
              strategies={strategies}
              selectedId={selected?.id ?? ""}
              onSelect={onSelect}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Parameter Grid
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-3">
            <Field label="Leverage (x)" value={levStr} onChange={setLevStr} hint="comma separated" />
            <Field label="Stop Loss (%)" value={slStr} onChange={setSlStr} hint="comma separated" />
            <Field label="Take Profit (%)" value={tpStr} onChange={setTpStr} hint="comma separated" />
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Days"
                value={String(days)}
                numeric
                onChange={(v) => setDays(Math.max(60, Math.min(1825, Number(v) || 60)))}
              />
              <Field
                label="Capital ($)"
                value={String(capital)}
                numeric
                onChange={(v) => setCapital(Math.max(100, Number(v) || 100))}
              />
            </div>
            <Separator className="my-2" />
            <div className="text-[10px] font-mono text-muted-foreground">
              {parseGrid(levStr).length * parseGrid(slStr).length * parseGrid(tpStr).length} combos
              (capped at 200)
            </div>
            <Button
              onClick={onRun}
              disabled={optM.isPending || !selected}
              className="w-full font-mono uppercase tracking-wider"
              size="lg"
            >
              {optM.isPending ? "Sweeping Grid…" : "Run Optimization"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-8 space-y-3 order-1 lg:order-2 min-w-0">
        <LoadingPanel
          active={optM.isPending}
          title="Sweeping the parameter grid"
          subtitle={`${selected?.name ?? ""} · ${parseGrid(levStr).length * parseGrid(slStr).length * parseGrid(tpStr).length} combos`}
          steps={[
            "Generating candle history…",
            "Pre-computing strategy signals…",
            "Iterating leverage × SL × TP…",
            "Scoring annual return / drawdown / sharpe…",
            "Ranking surviving configurations…",
          ]}
        />

        {optM.isError ? (
          <Card className="border-destructive/50">
            <CardContent className="p-4 text-sm text-red-300">
              Optimization failed: {(optM.error as Error)?.message ?? "unknown error"}
            </CardContent>
          </Card>
        ) : null}

        {!optM.isPending && !result ? (
          <Card>
            <CardContent className="p-6 sm:p-10 text-center scan-grid">
              <div className="text-sm text-muted-foreground font-mono uppercase tracking-wider">
                Awaiting Sweep
              </div>
              <div className="mt-2 text-base sm:text-lg">
                Define your leverage / SL / TP grids and let the optimizer hunt for the best combo.
              </div>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <>
            <Card>
              <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Best Configuration
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onApplyBest({
                      strategyId: result.strategyId,
                      leverage: result.best.leverage,
                      stopLossPct: result.best.stopLossPct,
                      takeProfitPct: result.best.takeProfitPct,
                    })
                  }
                  className="font-mono text-[10px] uppercase tracking-wider"
                >
                  Apply to Lab
                </Button>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {result.best.leverage}x leverage
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    SL {result.best.stopLossPct}%
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    TP {result.best.takeProfitPct}%
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px] uppercase",
                      getVerdictColor(result.best.metrics.verdict),
                    )}
                  >
                    {result.best.metrics.verdict}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <MetricCard
                    label="Annual Return"
                    value={formatPercent(result.best.metrics.annualReturnPct)}
                    tone={result.best.metrics.annualReturnPct >= 0 ? "positive" : "negative"}
                  />
                  <MetricCard
                    label="Final Equity"
                    value={formatDollar(result.best.metrics.finalEquity)}
                    tone="positive"
                  />
                  <MetricCard
                    label="Max DD"
                    value={formatPercent(result.best.metrics.maxDrawdownPct)}
                    tone="negative"
                  />
                  <MetricCard
                    label="Sharpe"
                    value={formatNumber(result.best.metrics.sharpe, 2)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Risk-Return Map (size = drawdown)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-4 pt-0">
                <div className="w-full" style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 24% 18%)" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Leverage"
                        stroke="hsl(215 16% 55%)"
                        fontSize={10}
                        unit="x"
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="Annual Return"
                        stroke="hsl(215 16% 55%)"
                        fontSize={10}
                        width={56}
                        tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                      />
                      <ZAxis type="number" dataKey="z" range={[40, 400]} />
                      <Tooltip
                        cursor={{ stroke: "hsl(152 90% 48%)", strokeOpacity: 0.3 }}
                        contentStyle={{
                          background: "hsl(222 32% 10%)",
                          border: "1px solid hsl(222 24% 18%)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={(value: number, key) => {
                          if (key === "x") return [`${value}x`, "Leverage"];
                          if (key === "y") return [`${value.toFixed(1)}%`, "APY"];
                          return [value, key];
                        }}
                        labelFormatter={() => ""}
                      />
                      <Scatter data={scatterData} isAnimationActive={false}>
                        {scatterData.map((d, i) => (
                          <Cell
                            key={i}
                            fill={
                              d.verdict === "blown"
                                ? "hsl(0 78% 58%)"
                                : d.verdict === "excellent"
                                  ? "hsl(152 90% 48%)"
                                  : d.verdict === "good"
                                    ? "hsl(198 90% 56%)"
                                    : d.verdict === "mediocre"
                                      ? "hsl(38 95% 58%)"
                                      : "hsl(0 78% 58% / 0.6)"
                            }
                            fillOpacity={0.75}
                            stroke="hsl(222 35% 6%)"
                          />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  All Combinations ({result.rows.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-4 pt-0">
                <div className="rounded-lg border border-card-border bg-card/60 overflow-hidden">
                  <ScrollArea className="h-[360px]">
                    <table className="w-full text-xs sm:text-sm font-mono">
                      <thead className="sticky top-0 bg-card/95 backdrop-blur z-10">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-2 sm:px-3 py-2 font-normal">Lev</th>
                          <th className="px-2 sm:px-3 py-2 font-normal">SL</th>
                          <th className="px-2 sm:px-3 py-2 font-normal">TP</th>
                          <th className="px-2 sm:px-3 py-2 font-normal text-right">APY</th>
                          <th className="px-2 sm:px-3 py-2 font-normal text-right">DD</th>
                          <th className="px-2 sm:px-3 py-2 font-normal text-right hidden sm:table-cell">Sharpe</th>
                          <th className="px-2 sm:px-3 py-2 font-normal text-right hidden sm:table-cell">Win%</th>
                          <th className="px-2 sm:px-3 py-2 font-normal text-right">Verdict</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((r, i) => {
                          const isBest = i === 0;
                          return (
                            <tr
                              key={i}
                              className={cn(
                                "border-t border-border/40 hover:bg-elevate-1",
                                isBest && "bg-primary/10",
                              )}
                            >
                              <td className="px-2 sm:px-3 py-1.5">{r.leverage}x</td>
                              <td className="px-2 sm:px-3 py-1.5">{r.stopLossPct}%</td>
                              <td className="px-2 sm:px-3 py-1.5">{r.takeProfitPct}%</td>
                              <td
                                className={cn(
                                  "px-2 sm:px-3 py-1.5 text-right",
                                  r.metrics.annualReturnPct >= 0
                                    ? "text-emerald-300"
                                    : "text-red-300",
                                )}
                              >
                                {formatPercent(r.metrics.annualReturnPct)}
                              </td>
                              <td className="px-2 sm:px-3 py-1.5 text-right text-red-300">
                                {formatPercent(r.metrics.maxDrawdownPct)}
                              </td>
                              <td className="px-2 sm:px-3 py-1.5 text-right hidden sm:table-cell">
                                {formatNumber(r.metrics.sharpe, 2)}
                              </td>
                              <td className="px-2 sm:px-3 py-1.5 text-right hidden sm:table-cell">
                                {formatNumber(r.metrics.winRate, 0)}%
                              </td>
                              <td className="px-2 sm:px-3 py-1.5 text-right">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] py-0 px-1.5 uppercase",
                                    getVerdictColor(r.metrics.verdict),
                                  )}
                                >
                                  {r.metrics.verdict}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  numeric?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        {hint ? <span className="text-[9px] text-muted-foreground/70">{hint}</span> : null}
      </div>
      <Input
        type={numeric ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 font-mono text-xs"
      />
    </div>
  );
}
