import { useEffect, useState } from "react";
import {
  useListStrategies,
  useCompareStrategies,
  type StrategyMeta,
  type BacktestRequest,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { LoadingPanel } from "@/components/LoadingPanel";
import { EquityChart } from "@/components/EquityChart";
import { formatDollar, formatNumber, formatPercent, getVerdictColor } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLORS = [
  "hsl(152 90% 48%)",
  "hsl(198 90% 56%)",
  "hsl(280 90% 64%)",
  "hsl(38 95% 58%)",
];

type Slot = {
  label: string;
  strategyId: string;
  leverage: number;
  stopLossPct: number;
  takeProfitPct: number;
};

const DEFAULT_SLOTS: Slot[] = [
  {
    label: "Conservative trend",
    strategyId: "ema_cross",
    leverage: 2,
    stopLossPct: 5,
    takeProfitPct: 15,
  },
  {
    label: "Balanced revert",
    strategyId: "rsi_revert",
    leverage: 3,
    stopLossPct: 4,
    takeProfitPct: 8,
  },
  {
    label: "Moonshot 100x dream",
    strategyId: "moonshot",
    leverage: 25,
    stopLossPct: 2,
    takeProfitPct: 40,
  },
];

export function ComparePage() {
  const stratsQ = useListStrategies();
  const strategies: StrategyMeta[] = stratsQ.data?.strategies ?? [];
  const [slots, setSlots] = useState<Slot[]>(DEFAULT_SLOTS);
  const [days, setDays] = useState(730);
  const [capital, setCapital] = useState(10_000);
  const compareM = useCompareStrategies();
  const result = compareM.data;

  useEffect(() => {
    if (strategies.length > 0 && !slots.every((s) => strategies.find((x) => x.id === s.strategyId))) {
      setSlots(DEFAULT_SLOTS);
    }
  }, [strategies.length]);

  const onRun = () => {
    const requests: BacktestRequest[] = slots.map((s) => {
      const strat = strategies.find((x) => x.id === s.strategyId);
      const params: Record<string, number> = {};
      if (strat) for (const p of strat.params) params[p.key] = p.default;
      return {
        strategyId: s.strategyId,
        params,
        leverage: s.leverage,
        stopLossPct: s.stopLossPct,
        takeProfitPct: s.takeProfitPct,
        days,
        initialCapital: capital,
        feePct: 0.06,
      };
    });
    compareM.mutate({ data: { requests } });
  };

  const updateSlot = (idx: number, patch: Partial<Slot>) => {
    setSlots((s) => s.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const addSlot = () => {
    if (slots.length >= 4) return;
    setSlots((s) => [
      ...s,
      {
        label: `Preset ${s.length + 1}`,
        strategyId: strategies[0]?.id ?? "ema_cross",
        leverage: 5,
        stopLossPct: 4,
        takeProfitPct: 12,
      },
    ]);
  };

  const removeSlot = (idx: number) => setSlots((s) => s.filter((_, i) => i !== idx));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
      <div className="lg:col-span-5 space-y-3 order-2 lg:order-1">
        <Card>
          <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Presets ({slots.length}/4)
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={addSlot}
              disabled={slots.length >= 4}
              className="font-mono text-[10px] uppercase"
            >
              + Add
            </Button>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-3">
            {slots.map((slot, i) => (
              <div
                key={i}
                className="rounded-lg border border-card-border bg-card/40 p-3 space-y-2"
                style={{ boxShadow: `inset 3px 0 0 ${COLORS[i] ?? "hsl(152 90% 48%)"}` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <Input
                    value={slot.label}
                    onChange={(e) => updateSlot(i, { label: e.target.value })}
                    className="h-7 text-xs font-mono"
                  />
                  {slots.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeSlot(i)}
                      className="h-7 px-2 text-[10px] text-muted-foreground"
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                <Select
                  value={slot.strategyId}
                  onValueChange={(v) => updateSlot(i, { strategyId: v })}
                >
                  <SelectTrigger className="h-8 text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {strategies.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs font-mono">
                        {s.name} ({s.risk})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-3 gap-2">
                  <Mini
                    label="Lev"
                    value={slot.leverage}
                    onChange={(v) => updateSlot(i, { leverage: v })}
                  />
                  <Mini
                    label="SL %"
                    value={slot.stopLossPct}
                    onChange={(v) => updateSlot(i, { stopLossPct: v })}
                  />
                  <Mini
                    label="TP %"
                    value={slot.takeProfitPct}
                    onChange={(v) => updateSlot(i, { takeProfitPct: v })}
                  />
                </div>
              </div>
            ))}

            <Separator />

            <div className="grid grid-cols-2 gap-2">
              <Mini label="Days" value={days} onChange={(v) => setDays(Math.max(60, v))} />
              <Mini
                label="Capital ($)"
                value={capital}
                onChange={(v) => setCapital(Math.max(100, v))}
              />
            </div>

            <Button
              onClick={onRun}
              disabled={compareM.isPending || slots.length === 0}
              className="w-full font-mono uppercase tracking-wider"
              size="lg"
            >
              {compareM.isPending ? "Running…" : "Run Comparison"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-7 space-y-3 order-1 lg:order-2 min-w-0">
        <LoadingPanel
          active={compareM.isPending}
          title="Comparing strategies"
          subtitle={`${slots.length} presets · ${days} days`}
          steps={[
            "Allocating workers per preset…",
            "Running backtests in parallel…",
            "Computing metrics…",
            "Aligning equity curves…",
          ]}
        />

        {compareM.isError ? (
          <Card className="border-destructive/50">
            <CardContent className="p-4 text-sm text-red-300">
              Comparison failed: {(compareM.error as Error)?.message ?? "unknown error"}
            </CardContent>
          </Card>
        ) : null}

        {!compareM.isPending && !result ? (
          <Card>
            <CardContent className="p-6 sm:p-10 text-center scan-grid">
              <div className="text-sm text-muted-foreground font-mono uppercase tracking-wider">
                Awaiting Comparison
              </div>
              <div className="mt-2 text-base sm:text-lg">
                Tweak presets and run them head-to-head on the same BTC history.
              </div>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <>
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Equity Curves
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-4 pt-0">
                <EquityChart
                  series={result.results.map((r, i) => ({
                    name: slots[i]?.label ?? r.strategyId,
                    color: COLORS[i] ?? "hsl(152 90% 48%)",
                    data: r.equityCurve,
                  }))}
                  height={280}
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
                  series={result.results.map((r, i) => ({
                    name: slots[i]?.label ?? r.strategyId,
                    color: COLORS[i] ?? "hsl(152 90% 48%)",
                    data: r.equityCurve,
                  }))}
                  height={200}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Side-by-Side Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-4 pt-0">
                <div className="rounded-lg border border-card-border bg-card/60 overflow-hidden overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm font-mono min-w-[640px]">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 sm:px-3 py-2 font-normal">Preset</th>
                        <th className="px-2 sm:px-3 py-2 font-normal text-right">APY</th>
                        <th className="px-2 sm:px-3 py-2 font-normal text-right">Total</th>
                        <th className="px-2 sm:px-3 py-2 font-normal text-right">Final $</th>
                        <th className="px-2 sm:px-3 py-2 font-normal text-right">Max DD</th>
                        <th className="px-2 sm:px-3 py-2 font-normal text-right">Sharpe</th>
                        <th className="px-2 sm:px-3 py-2 font-normal text-right">Win%</th>
                        <th className="px-2 sm:px-3 py-2 font-normal text-right">Trades</th>
                        <th className="px-2 sm:px-3 py-2 font-normal text-right">Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.results.map((r, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td className="px-2 sm:px-3 py-1.5">
                            <span
                              className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                              style={{ background: COLORS[i] ?? "hsl(152 90% 48%)" }}
                            />
                            {slots[i]?.label ?? r.strategyId}
                          </td>
                          <td
                            className={cn(
                              "px-2 sm:px-3 py-1.5 text-right",
                              r.metrics.annualReturnPct >= 0 ? "text-emerald-300" : "text-red-300",
                            )}
                          >
                            {formatPercent(r.metrics.annualReturnPct)}
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 text-right">
                            {formatPercent(r.metrics.totalReturnPct)}
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 text-right">
                            {formatDollar(r.metrics.finalEquity)}
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 text-right text-red-300">
                            {formatPercent(r.metrics.maxDrawdownPct)}
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 text-right">
                            {formatNumber(r.metrics.sharpe, 2)}
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 text-right">
                            {formatNumber(r.metrics.winRate, 0)}%
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 text-right">{r.metrics.trades}</td>
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
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label className="block text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </label>
      <Input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="h-7 text-xs font-mono"
      />
    </div>
  );
}
