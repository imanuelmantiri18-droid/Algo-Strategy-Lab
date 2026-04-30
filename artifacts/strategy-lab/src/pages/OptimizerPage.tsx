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
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingPanel } from "@/components/LoadingPanel";
import { MetricCard } from "@/components/MetricCard";
import { DEFAULT_RISK } from "@/components/LabControls";
import {
  formatDollar,
  formatNumber,
  formatPercent,
  getVerdictColor,
  INTERVAL_OPTIONS,
  type IntervalValue,
} from "@/lib/format";
import { cn } from "@/lib/utils";

function parseGrid(input: string): number[] {
  return input
    .split(/[, ]+/)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n));
}

const DEFAULT_AXES: Record<string, string> = {
  emaFast: "10, 20, 30",
  emaSlow: "50, 100, 200",
  rsiThreshold: "40, 50, 60",
  atrMultiplierSL: "1.0, 1.5, 2.0",
  riskRewardRatio: "2, 3",
  leverage: "10, 15, 20",
};

const AXIS_META: Array<{ key: string; label: string; hint: string }> = [
  { key: "emaFast", label: "EMA fast", hint: "fast EMA periods" },
  { key: "emaSlow", label: "EMA slow", hint: "slow EMA periods" },
  { key: "rsiThreshold", label: "RSI threshold", hint: "long if RSI > , short if <" },
  { key: "atrMultiplierSL", label: "ATR × SL", hint: "stop loss distance" },
  { key: "riskRewardRatio", label: "R:R", hint: "TP = SL × this" },
  { key: "leverage", label: "Leverage (x)", hint: "futures leverage" },
];

type Props = {
  interval: IntervalValue;
  lookbackDays: number;
  initialCapital: number;
  onApplyBest: (best: {
    params: Record<string, number>;
    risk: typeof DEFAULT_RISK;
  }) => void;
};

export function OptimizerPage({
  interval: initialInterval,
  lookbackDays: initialDays,
  initialCapital: initialCap,
  onApplyBest,
}: Props) {
  const stratsQ = useListStrategies();
  const strategies: StrategyMeta[] = stratsQ.data?.strategies ?? [];
  const strategy = strategies[0];

  const [interval, setInterval] = useState<IntervalValue>(initialInterval);
  const [lookbackDays, setLookbackDays] = useState(initialDays);
  const [capital, setCapital] = useState(initialCap);
  const [maxDDFilter, setMaxDDFilter] = useState(40);
  const [walkSplit, setWalkSplit] = useState(0.7);
  const [axes, setAxes] = useState<Record<string, string>>(DEFAULT_AXES);

  useEffect(() => {
    setInterval(initialInterval);
    setLookbackDays(initialDays);
    setCapital(initialCap);
  }, [initialInterval, initialDays, initialCap]);

  const optM = useRunOptimization();
  const result = optM.data;

  const comboCount = useMemo(() => {
    let total = 1;
    for (const k of Object.keys(axes)) {
      const arr = parseGrid(axes[k] ?? "");
      total *= arr.length || 1;
    }
    return total;
  }, [axes]);

  const onRun = () => {
    if (!strategy) return;
    const baseParams: Record<string, number> = {};
    for (const p of strategy.params) baseParams[p.key] = p.default;
    const axesPayload = Object.entries(axes)
      .map(([key, value]) => ({ key, values: parseGrid(value) }))
      .filter((a) => a.values.length > 0);

    optM.mutate({
      data: {
        strategyId: strategy.id,
        baseParams,
        baseRisk: DEFAULT_RISK,
        axes: axesPayload,
        interval,
        lookbackDays,
        initialCapital: capital,
        walkForwardSplit: walkSplit,
        maxDrawdownFilterPct: maxDDFilter,
        maxCombos: 10000,
      },
    });
  };

  const scatterData = useMemo(() => {
    if (!result) return [];
    return result.rows.map((r) => ({
      x: r.outOfSample.annualReturnPct,
      y: r.inSample.annualReturnPct,
      z: Math.abs(r.outOfSample.maxDrawdownPct) + 5,
      verdict: r.outOfSample.verdict,
      filtered: r.filtered,
      robustness: r.robustnessScore,
    }));
  }, [result]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
      <div className="lg:col-span-4 space-y-3 order-2 lg:order-1">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Market &amp; Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-3">
            <Field
              label="Timeframe"
              control={
                <Select
                  value={interval}
                  onValueChange={(v) => setInterval(v as IntervalValue)}
                >
                  <SelectTrigger className="h-8 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        className="font-mono text-xs"
                      >
                        {opt.value} · {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label="Lookback (days)"
                value={lookbackDays}
                min={30}
                max={1825}
                step={15}
                onChange={setLookbackDays}
              />
              <NumField
                label="Capital ($)"
                value={capital}
                min={100}
                max={100_000}
                step={100}
                onChange={setCapital}
              />
            </div>
            <SliderField
              label="Walk-forward split"
              value={walkSplit}
              min={0.5}
              max={0.9}
              step={0.05}
              hint={`${Math.round(walkSplit * 100)}% IS / ${Math.round((1 - walkSplit) * 100)}% OOS`}
              onChange={setWalkSplit}
            />
            <SliderField
              label="Max-DD filter"
              value={maxDDFilter}
              min={10}
              max={90}
              step={5}
              hint={`Drop combos with in-sample drawdown > ${maxDDFilter}%`}
              suffix="%"
              onChange={setMaxDDFilter}
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
            {AXIS_META.map((axis) => (
              <Field
                key={axis.key}
                label={axis.label}
                hint={axis.hint}
                control={
                  <Input
                    value={axes[axis.key] ?? ""}
                    onChange={(e) =>
                      setAxes((s) => ({ ...s, [axis.key]: e.target.value }))
                    }
                    className="h-8 font-mono text-xs"
                    placeholder="comma separated"
                  />
                }
              />
            ))}

            <Separator className="my-2" />
            <div className="text-[10px] font-mono text-muted-foreground flex items-center justify-between">
              <span>{comboCount} combos</span>
              <span>{comboCount > 10000 ? "(capped at 10000)" : "(cap 10000)"}</span>
            </div>
            <Button
              onClick={onRun}
              disabled={optM.isPending || !strategy}
              className="w-full font-mono uppercase tracking-wider"
              size="lg"
            >
              {optM.isPending ? "Sweeping…" : "Run Optimization"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-8 space-y-3 order-1 lg:order-2 min-w-0">
        <LoadingPanel
          active={optM.isPending}
          title="Sweeping the parameter grid"
          subtitle={`${comboCount} combos · ${interval} · ${lookbackDays}d`}
          steps={[
            `Fetching real BTC/USDT ${interval} klines from Binance…`,
            `Caching ${lookbackDays} days of price history…`,
            `Pre-computing EMA, RSI, ATR for ${comboCount} combos…`,
            "Building cartesian product of parameter axes…",
            "Running in-sample backtests for every combo…",
            "Running out-of-sample forward tests…",
            `Filtering combos with > ${maxDDFilter}% drawdown…`,
            "Ranking by OOS APY × robustness score…",
          ]}
        />

        {optM.isError ? (
          <Card className="border-destructive/50">
            <CardContent className="p-4 text-sm text-red-300">
              Optimization failed:{" "}
              {(optM.error as Error)?.message ?? "unknown error"}
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
                Edit each axis (comma separated values), then sweep up to 10,000
                combos.
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Default grid: 162 combos · ~30s on 1h timeframe.
              </div>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <>
            <Card>
              <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Best (Out-of-Sample)
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onApplyBest({
                      params: result.best.params,
                      risk: result.best.risk,
                    })
                  }
                  className="font-mono text-[10px] uppercase tracking-wider"
                >
                  Apply to Lab
                </Button>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0 space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.entries(result.best.params).map(([k, v]) => (
                    <Badge
                      key={k}
                      variant="outline"
                      className="font-mono text-[10px]"
                    >
                      {k} {v}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {result.best.risk.leverage}x lev
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    ATR×{result.best.risk.atrMultiplierSL}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    1:{result.best.risk.riskRewardRatio}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px] uppercase",
                      getVerdictColor(result.best.outOfSample.verdict),
                    )}
                  >
                    {result.best.outOfSample.verdict}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <MetricCard
                    label="OOS APY"
                    value={formatPercent(result.best.outOfSample.annualReturnPct)}
                    tone={
                      result.best.outOfSample.annualReturnPct >= 0
                        ? "positive"
                        : "negative"
                    }
                    hint={`IS ${formatPercent(result.best.inSample.annualReturnPct)}`}
                  />
                  <MetricCard
                    label="Robustness"
                    value={formatNumber(result.best.robustnessScore, 2)}
                    tone={
                      result.best.robustnessScore >= 0.7
                        ? "positive"
                        : result.best.robustnessScore >= 0.3
                          ? "warn"
                          : "negative"
                    }
                    hint="OOS APY ÷ IS APY"
                  />
                  <MetricCard
                    label="OOS Max DD"
                    value={formatPercent(result.best.outOfSample.maxDrawdownPct)}
                    tone="negative"
                    hint={`IS ${formatPercent(result.best.inSample.maxDrawdownPct)}`}
                  />
                  <MetricCard
                    label="OOS Sharpe"
                    value={formatNumber(result.best.outOfSample.sharpe, 2)}
                  />
                </div>
                <div className="text-[10px] font-mono text-muted-foreground flex items-center justify-between border-t border-border/40 pt-2">
                  <span>
                    {result.kept} kept · {result.dropped} dropped (DD &gt;{" "}
                    {result.drawdownFilterPct}%)
                  </span>
                  <span>{result.totalCombos} total combos</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  In-Sample vs Out-of-Sample (size = OOS drawdown)
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
                        name="OOS APY"
                        stroke="hsl(215 16% 55%)"
                        fontSize={10}
                        tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="IS APY"
                        stroke="hsl(215 16% 55%)"
                        fontSize={10}
                        width={56}
                        tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                      />
                      <ZAxis type="number" dataKey="z" range={[40, 320]} />
                      <Tooltip
                        cursor={{ stroke: "hsl(152 90% 48%)", strokeOpacity: 0.3 }}
                        contentStyle={{
                          background: "hsl(222 32% 10%)",
                          border: "1px solid hsl(222 24% 18%)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={(value: number, key) => {
                          if (key === "x") return [`${value.toFixed(1)}%`, "OOS APY"];
                          if (key === "y") return [`${value.toFixed(1)}%`, "IS APY"];
                          return [value, key];
                        }}
                        labelFormatter={() => ""}
                      />
                      <Scatter data={scatterData} isAnimationActive={false}>
                        {scatterData.map((d, i) => (
                          <Cell
                            key={i}
                            fill={
                              d.filtered
                                ? "hsl(0 0% 40%)"
                                : d.verdict === "blown"
                                  ? "hsl(0 78% 58%)"
                                  : d.verdict === "excellent"
                                    ? "hsl(152 90% 48%)"
                                    : d.verdict === "good"
                                      ? "hsl(198 90% 56%)"
                                      : d.verdict === "mediocre"
                                        ? "hsl(38 95% 58%)"
                                        : "hsl(0 78% 58% / 0.6)"
                            }
                            fillOpacity={d.filtered ? 0.3 : 0.8}
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
                  <ScrollArea className="h-[400px]">
                    <table className="w-full text-xs sm:text-sm font-mono min-w-[760px]">
                      <thead className="sticky top-0 bg-card/95 backdrop-blur z-10">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-2 py-2 font-normal">Params</th>
                          <th className="px-2 py-2 font-normal">Risk</th>
                          <th className="px-2 py-2 font-normal text-right">IS APY</th>
                          <th className="px-2 py-2 font-normal text-right">OOS APY</th>
                          <th className="px-2 py-2 font-normal text-right">OOS DD</th>
                          <th className="px-2 py-2 font-normal text-right">Robust</th>
                          <th className="px-2 py-2 font-normal text-right">OOS Verdict</th>
                          <th className="px-2 py-2 font-normal text-right">Apply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((r, i) => {
                          const isBest = r === result.best;
                          return (
                            <tr
                              key={i}
                              className={cn(
                                "border-t border-border/40 hover:bg-elevate-1",
                                isBest && "bg-primary/10",
                                r.filtered && "opacity-50",
                              )}
                            >
                              <td className="px-2 py-1.5 text-[10px]">
                                {Object.entries(r.params)
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join(" · ")}
                              </td>
                              <td className="px-2 py-1.5 text-[10px] text-muted-foreground whitespace-nowrap">
                                {r.risk.leverage}x · ATR×{r.risk.atrMultiplierSL} ·
                                1:{r.risk.riskRewardRatio}
                              </td>
                              <td
                                className={cn(
                                  "px-2 py-1.5 text-right",
                                  r.inSample.annualReturnPct >= 0
                                    ? "text-emerald-300"
                                    : "text-red-300",
                                )}
                              >
                                {formatPercent(r.inSample.annualReturnPct)}
                              </td>
                              <td
                                className={cn(
                                  "px-2 py-1.5 text-right",
                                  r.outOfSample.annualReturnPct >= 0
                                    ? "text-emerald-300"
                                    : "text-red-300",
                                )}
                              >
                                {formatPercent(r.outOfSample.annualReturnPct)}
                              </td>
                              <td className="px-2 py-1.5 text-right text-red-300">
                                {formatPercent(r.outOfSample.maxDrawdownPct)}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                {formatNumber(r.robustnessScore, 2)}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] py-0 px-1.5 uppercase",
                                    getVerdictColor(r.outOfSample.verdict),
                                  )}
                                >
                                  {r.filtered ? "filt" : r.outOfSample.verdict}
                                </Badge>
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[9px] font-mono uppercase"
                                  onClick={() =>
                                    onApplyBest({ params: r.params, risk: r.risk })
                                  }
                                >
                                  use
                                </Button>
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
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        {hint ? (
          <span className="text-[9px] text-muted-foreground/70 font-mono">
            {hint}
          </span>
        ) : null}
      </div>
      {control}
    </div>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field
      label={label}
      control={
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(n);
          }}
          className="h-8 font-mono text-xs"
        />
      }
    />
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  hint,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) onChange(n);
            }}
            className="h-7 w-16 text-right font-mono text-xs px-2"
          />
          {suffix ? (
            <span className="text-xs text-muted-foreground font-mono w-3">
              {suffix}
            </span>
          ) : null}
        </div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? value)}
      />
      {hint ? (
        <div className="text-[10px] text-muted-foreground/70 font-mono">{hint}</div>
      ) : null}
    </div>
  );
}
