import { useMemo, useState } from "react";
import {
  useRunTournament,
  type TournamentRow,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { LoadingPanel } from "@/components/LoadingPanel";
import { LEVERAGE_PRESETS, type LabConfig } from "@/components/LabControls";
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

type SortKey = "robustness" | "oosApy" | "oosReturn" | "isApy" | "sharpe" | "drawdown";

export function TournamentPage({ baseConfig, onApply }: Props) {
  const runM = useRunTournament();
  const [splitDate, setSplitDate] = useState<string>(
    baseConfig.walkForwardSplitDate ?? "2025-01-01",
  );
  const [maxDD, setMaxDD] = useState<number>(40);
  const [leverage, setLeverage] = useState<number>(baseConfig.risk.leverage);
  const [interval, setInterval] = useState<string>(baseConfig.interval);
  const [lookbackDays, setLookbackDays] = useState<number>(
    baseConfig.lookbackDays,
  );
  const [sortKey, setSortKey] = useState<SortKey>("robustness");
  const [hideFiltered, setHideFiltered] = useState<boolean>(true);
  const [hideErrored, setHideErrored] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const onRun = () => {
    runM.mutate({
      data: {
        interval: interval as LabConfig["interval"],
        lookbackDays,
        initialCapital: baseConfig.initialCapital,
        risk: { ...baseConfig.risk, leverage },
        walkForwardSplitDate: splitDate,
        maxDrawdownFilterPct: maxDD,
      },
    });
  };

  const result = runM.data;

  const sortedRows = useMemo<TournamentRow[]>(() => {
    if (!result) return [];
    let rows = [...result.rows];
    if (hideErrored) rows = rows.filter((r) => !r.error);
    if (hideFiltered) rows = rows.filter((r) => !r.filtered);
    if (categoryFilter !== "all")
      rows = rows.filter((r) => r.category === categoryFilter);

    rows.sort((a, b) => {
      switch (sortKey) {
        case "robustness":
          return (b.robustnessScore ?? 0) - (a.robustnessScore ?? 0);
        case "oosApy":
          return (
            (b.outOfSample.annualReturnPct ?? 0) -
            (a.outOfSample.annualReturnPct ?? 0)
          );
        case "oosReturn":
          return (
            (b.outOfSample.totalReturnPct ?? 0) -
            (a.outOfSample.totalReturnPct ?? 0)
          );
        case "isApy":
          return (
            (b.inSample.annualReturnPct ?? 0) -
            (a.inSample.annualReturnPct ?? 0)
          );
        case "sharpe":
          return (b.outOfSample.sharpe ?? 0) - (a.outOfSample.sharpe ?? 0);
        case "drawdown":
          return (a.outOfSample.maxDrawdownPct ?? 0) - (b.outOfSample.maxDrawdownPct ?? 0);
      }
    });
    return rows;
  }, [result, sortKey, hideFiltered, hideErrored, categoryFilter]);

  const categories = useMemo(() => {
    if (!result) return [];
    return Array.from(new Set(result.rows.map((r) => r.category)));
  }, [result]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
      <div className="lg:col-span-4 space-y-3 order-2 lg:order-1">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Tournament
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
              Runs every available strategy with default params. Trained on data
              before the split date, tested after. Best algorithm wins by
              robustness score (out-of-sample APY × consistency vs in-sample).
            </p>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Train / Test Split
              </label>
              <Input
                type="date"
                value={splitDate}
                onChange={(e) => setSplitDate(e.target.value)}
                className="h-9 font-mono text-xs"
              />
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] font-mono px-2"
                  onClick={() => setSplitDate("2025-01-01")}
                >
                  Train 2024 / Test 2025+
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] font-mono px-2"
                  onClick={() => setSplitDate("2024-01-01")}
                >
                  Train pre-2024 / Test 2024+
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Leverage
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {LEVERAGE_PRESETS.map((p) => {
                  const active = leverage === p.value;
                  return (
                    <Button
                      key={p.value}
                      type="button"
                      variant={active ? "default" : "outline"}
                      className={`h-10 flex flex-col gap-0 font-mono ${active ? "glow-primary" : ""}`}
                      onClick={() => setLeverage(p.value)}
                    >
                      <span className="text-sm font-bold leading-tight">{p.label}</span>
                      <span className="text-[8px] uppercase tracking-wider opacity-80">{p.tone}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex justify-between">
                <span>Timeframe</span>
                <span className="text-primary font-mono">{interval}</span>
              </label>
              <div className="grid grid-cols-5 gap-1">
                {["15m", "1h", "4h", "1d", "1w"].map((tf) => (
                  <Button
                    key={tf}
                    type="button"
                    variant={interval === tf ? "default" : "outline"}
                    className="h-7 font-mono text-[10px]"
                    onClick={() => setInterval(tf)}
                  >
                    {tf}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex justify-between">
                <span>Lookback (days)</span>
                <span className="text-primary font-mono">{lookbackDays}d</span>
              </label>
              <Slider
                value={[lookbackDays]}
                min={180}
                max={1825}
                step={30}
                onValueChange={(v) => setLookbackDays(v[0] ?? 730)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex justify-between">
                <span>Max Drawdown Filter</span>
                <span className="text-primary font-mono">≤ {maxDD}%</span>
              </label>
              <Slider
                value={[maxDD]}
                min={10}
                max={90}
                step={5}
                onValueChange={(v) => setMaxDD(v[0] ?? 40)}
              />
              <div className="text-[10px] text-muted-foreground/70 font-mono">
                Strategies with worse OOS drawdown are flagged as filtered.
              </div>
            </div>

            <Separator />

            <Button
              onClick={onRun}
              disabled={runM.isPending}
              className="w-full font-mono uppercase tracking-wider"
              size="lg"
            >
              {runM.isPending ? "Running Tournament…" : "Run Tournament"}
            </Button>
            <p className="text-[10px] text-amber-300/70 leading-snug">
              ~40 strategies × ~1–10s each. Stay on this tab while it runs.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-8 space-y-3 order-1 lg:order-2 min-w-0">
        <LoadingPanel
          active={runM.isPending}
          title="Running tournament"
          subtitle={`${interval} · ${lookbackDays}d · ${leverage}× · split ${splitDate}`}
          steps={[
            "Fetching real BTC/USDT klines from Binance…",
            "Computing indicators across the full library…",
            "Running every available strategy on the in-sample window…",
            "Forward-testing each on the out-of-sample window…",
            "Filtering by max drawdown…",
            "Scoring robustness across train/test…",
            "Building leaderboard…",
          ]}
        />

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
                Find the best algorithm
              </div>
              <div className="mt-2 text-base sm:text-lg">
                Pick a split date, set your leverage, and run the full library.
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Default: train on BTC 2024 · test on 2025+ · 5× · 4h · DD ≤ 40%.
              </div>
            </CardContent>
          </Card>
        ) : null}

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
              <BestRow row={result.best} onApply={onApply} initialCapital={baseConfig.initialCapital} />
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center justify-between flex-wrap gap-2">
                <span>Leaderboard ({sortedRows.length})</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <SortPill v={sortKey} k="robustness" set={setSortKey} label="Robust" />
                  <SortPill v={sortKey} k="oosApy" set={setSortKey} label="OOS APY" />
                  <SortPill v={sortKey} k="oosReturn" set={setSortKey} label="OOS Return" />
                  <SortPill v={sortKey} k="isApy" set={setSortKey} label="IS APY" />
                  <SortPill v={sortKey} k="sharpe" set={setSortKey} label="Sharpe" />
                  <SortPill v={sortKey} k="drawdown" set={setSortKey} label="Min DD" />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-4 pt-0 space-y-2">
              <div className="flex items-center gap-1 flex-wrap">
                <FilterPill
                  active={categoryFilter === "all"}
                  onClick={() => setCategoryFilter("all")}
                >
                  All
                </FilterPill>
                {categories.map((c) => (
                  <FilterPill
                    key={c}
                    active={categoryFilter === c}
                    onClick={() => setCategoryFilter(c)}
                  >
                    {categoryLabel[c] ?? c.toUpperCase()}
                  </FilterPill>
                ))}
                <span className="mx-2 h-4 w-px bg-border/60" />
                <FilterPill active={hideFiltered} onClick={() => setHideFiltered((x) => !x)}>
                  {hideFiltered ? "✓" : "○"} Hide DD-filtered
                </FilterPill>
                <FilterPill active={hideErrored} onClick={() => setHideErrored((x) => !x)}>
                  {hideErrored ? "✓" : "○"} Hide errors
                </FilterPill>
              </div>

              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-[11px] font-mono">
                  <thead className="text-muted-foreground/70 uppercase tracking-wider">
                    <tr className="border-b border-border/60">
                      <th className="text-left py-1.5 px-2">#</th>
                      <th className="text-left py-1.5 px-2">Strategy</th>
                      <th className="text-right py-1.5 px-2">OOS APY</th>
                      <th className="text-right py-1.5 px-2">OOS Ret</th>
                      <th className="text-right py-1.5 px-2">DD</th>
                      <th className="text-right py-1.5 px-2">Sharpe</th>
                      <th className="text-right py-1.5 px-2">Win%</th>
                      <th className="text-right py-1.5 px-2">PF</th>
                      <th className="text-right py-1.5 px-2">Trades</th>
                      <th className="text-right py-1.5 px-2">Robust</th>
                      <th className="text-right py-1.5 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r, i) => (
                      <Row
                        key={r.strategyId}
                        rank={i + 1}
                        row={r}
                        onApply={onApply}
                      />
                    ))}
                  </tbody>
                </table>
                {sortedRows.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-6">
                    No strategies match these filters.
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function SortPill({
  v,
  k,
  set,
  label,
}: {
  v: SortKey;
  k: SortKey;
  set: (k: SortKey) => void;
  label: string;
}) {
  const active = v === k;
  return (
    <button
      type="button"
      onClick={() => set(k)}
      className={cn(
        "h-6 px-2 rounded text-[10px] font-mono uppercase tracking-wider border transition",
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-6 px-2 rounded text-[10px] font-mono uppercase tracking-wider border transition",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
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
    <tr
      className={cn(
        "border-b border-border/30 hover:bg-card/40",
        row.filtered && "opacity-60",
        row.error && "opacity-50",
      )}
    >
      <td className="py-1.5 px-2 text-muted-foreground">{rank}</td>
      <td className="py-1.5 px-2">
        <div className="font-semibold text-[12px] truncate max-w-[180px]">{row.strategyName}</div>
        <div className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
          {categoryLabel[row.category] ?? row.category}
          {row.filtered ? " · DD" : ""}
          {row.error ? ` · ${row.error.slice(0, 30)}` : ""}
        </div>
      </td>
      <td className={cn("py-1.5 px-2 text-right", apyColor)}>
        {formatPercent(oos.annualReturnPct, 1)}
      </td>
      <td className="py-1.5 px-2 text-right">{formatPercent(oos.totalReturnPct, 1)}</td>
      <td className="py-1.5 px-2 text-right text-red-300/80">
        {formatPercent(oos.maxDrawdownPct, 1)}
      </td>
      <td className="py-1.5 px-2 text-right">{formatNumber(oos.sharpe, 2)}</td>
      <td className="py-1.5 px-2 text-right">{formatNumber(oos.winRate, 1)}</td>
      <td className="py-1.5 px-2 text-right">{formatNumber(oos.profitFactor, 2)}</td>
      <td className="py-1.5 px-2 text-right text-muted-foreground">{oos.trades}</td>
      <td className="py-1.5 px-2 text-right">
        <span className="text-primary">{formatNumber(row.robustnessScore, 2)}</span>
      </td>
      <td className="py-1.5 px-2 text-right">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] font-mono px-2"
          disabled={!!row.error}
          onClick={() => onApply(row.strategyId)}
        >
          Open →
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
            className="h-8 font-mono text-[11px] uppercase tracking-wider"
            onClick={() => onApply(row.strategyId)}
          >
            Open in Lab →
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="OOS APY" value={formatPercent(oos.annualReturnPct, 1)} accent />
        <Stat label="OOS Return" value={formatPercent(oos.totalReturnPct, 1)} />
        <Stat label="OOS Equity" value={formatDollar(oos.finalEquity)} sub={`from ${formatDollar(initialCapital)}`} />
        <Stat label="Max DD" value={formatPercent(oos.maxDrawdownPct, 1)} />
        <Stat label="Sharpe" value={formatNumber(oos.sharpe, 2)} />
        <Stat label="Sortino" value={formatNumber(oos.sortino, 2)} />
        <Stat label="Win Rate" value={`${formatNumber(oos.winRate, 1)}%`} />
        <Stat label="Trades" value={`${oos.trades}`} sub={`${oos.wins}W / ${oos.losses}L`} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-card-border bg-card/40 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">
        {label}
      </div>
      <div className={cn("text-base font-mono font-bold", accent && "text-primary")}>
        {value}
      </div>
      {sub ? <div className="text-[9px] text-muted-foreground/60 font-mono">{sub}</div> : null}
    </div>
  );
}
