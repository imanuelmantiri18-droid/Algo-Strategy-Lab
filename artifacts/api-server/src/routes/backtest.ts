import { Router, type IRouter } from "express";
import {
  RunBacktestBody,
  RunOptimizationBody,
  CompareStrategiesBody,
  RunTournamentBody,
} from "@workspace/api-zod";
import { getStrategy, availableStrategies, STRATEGIES } from "../lib/strategies";
import { getBtcHistory } from "../lib/marketData";
import { getHlHistory } from "../lib/hyperliquidData";
import {
  runBacktest,
  runBacktestMetricsOnly,
  type BacktestRequest,
  type BacktestResult,
  type RiskConfig,
} from "../lib/backtest";
import type { Candle, Interval } from "../types/strategy";

async function fetchCandles(
  dataSource: string | undefined | null,
  symbol: string | undefined | null,
  interval: Interval,
  lookbackDays: number,
): Promise<Candle[]> {
  if (dataSource === "hyperliquid") {
    const coin = (symbol || "BTC").toUpperCase().trim();
    return getHlHistory(coin, interval, lookbackDays);
  }
  return getBtcHistory(interval, lookbackDays);
}

const router: IRouter = Router();

router.post("/backtest/run", async (req, res, next) => {
  const parsed = RunBacktestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data as BacktestRequest;
  const strat = getStrategy(body.strategyId);
  if (!strat) {
    res.status(400).json({ error: `Unknown strategy: ${body.strategyId}` });
    return;
  }
  try {
    const candles = await fetchCandles(
      parsed.data.dataSource,
      parsed.data.symbol,
      body.interval as Interval,
      body.lookbackDays,
    );
    if (candles.length < 50) {
      res.status(400).json({
        error: `Not enough candles fetched (${candles.length}). Try a longer lookback or shorter interval.`,
      });
      return;
    }
    const result: BacktestResult = runBacktest(strat, candles, body);
    // OPT 4: cap chart payload size for very large lookbacks. Keep raw data
    // server-side for metric computation; downsample only what we ship.
    const CHART_TARGET = 2000;
    const slim: BacktestResult = {
      ...result,
      candles: downsampleByStride(result.candles, CHART_TARGET),
      equityCurve: downsampleByStride(result.equityCurve, CHART_TARGET),
    };
    res.json(slim);
  } catch (err) {
    next(err);
  }
});

type Combo = {
  params: Record<string, number>;
  risk: RiskConfig;
};

const RISK_KEYS = new Set([
  "leverage",
  "atrPeriod",
  "atrMultiplierSL",
  "riskRewardRatio",
  "makerFeePct",
  "takerFeePct",
  "slippagePct",
  "riskPerTradePct",
  "fundingRatePct8h",
  "maxHoldingBars",
]);

/**
 * OPT 4: When the equity/price series is large, the JSON payload back to the
 * browser dominates response time. We deliver every trade, but the chart
 * series get downsampled to a manageable target so the wire payload (and
 * client paint cost) stays bounded. Trade entries/exits remain referenced by
 * timestamp, so visually the chart still aligns even with stride > 1.
 */
function downsampleByStride<T>(arr: T[], target: number): T[] {
  if (arr.length <= target || target <= 0) return arr;
  const stride = Math.ceil(arr.length / target);
  if (stride <= 1) return arr;
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += stride) out.push(arr[i]!);
  // Always include the last bar so the chart's right edge is accurate.
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]!);
  return out;
}

function buildCombos(
  baseParams: Record<string, number>,
  baseRisk: RiskConfig,
  axes: Array<{ key: string; values: number[] }>,
  cap: number,
): Combo[] {
  const filtered = axes.filter((a) => a.values.length > 0);
  if (filtered.length === 0) {
    return [{ params: { ...baseParams }, risk: { ...baseRisk } }];
  }
  let total = 1;
  for (const a of filtered) total *= a.values.length;
  if (total > cap) {
    // Trim the LAST axis until under cap
    // (deterministic — caller is expected to keep total <= cap)
    let i = filtered.length - 1;
    while (total > cap && i >= 0) {
      const a = filtered[i]!;
      while (a.values.length > 1 && total > cap) {
        a.values.pop();
        total = filtered.reduce((acc, x) => acc * x.values.length, 1);
      }
      i--;
    }
  }

  const combos: Combo[] = [];
  const indices = new Array(filtered.length).fill(0);
  while (true) {
    const params = { ...baseParams };
    const risk: RiskConfig = { ...baseRisk };
    for (let k = 0; k < filtered.length; k++) {
      const axis = filtered[k]!;
      const val = axis.values[indices[k]!]!;
      if (RISK_KEYS.has(axis.key)) {
        (risk as unknown as Record<string, number>)[axis.key] = val;
      } else {
        params[axis.key] = val;
      }
    }
    combos.push({ params, risk });
    // increment
    let k = filtered.length - 1;
    while (k >= 0) {
      indices[k]!++;
      if (indices[k]! < filtered[k]!.values.length) break;
      indices[k] = 0;
      k--;
    }
    if (k < 0) break;
  }
  return combos;
}

router.post("/backtest/optimize", async (req, res, next) => {
  const parsed = RunOptimizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  const strat = getStrategy(body.strategyId);
  if (!strat) {
    res.status(400).json({ error: `Unknown strategy: ${body.strategyId}` });
    return;
  }

  try {
    const candles = await fetchCandles(
      body.dataSource,
      body.symbol,
      body.interval as Interval,
      body.lookbackDays,
    );
    if (candles.length < 100) {
      res.status(400).json({
        error: `Not enough candles fetched (${candles.length}). Try a longer lookback or shorter interval.`,
      });
      return;
    }

    const cap = Math.min(body.maxCombos ?? 10000, 10000);
    const ddFilter = body.maxDrawdownFilterPct ?? 40;
    const topN = Math.max(1, Math.min(body.topN ?? 100, 500));
    const combos = buildCombos(
      body.baseParams,
      body.baseRisk as RiskConfig,
      body.axes.map((a) => ({ key: a.key, values: [...a.values] })),
      cap,
    );

    const { rows, kept, dropped } = await runOptimizerLoop(
      strat,
      candles,
      combos,
      body,
      ddFilter,
      undefined,
    );

    const sorted = sortOptimizerRows(rows);
    const best = sorted.find((r) => !r.filtered) ?? sorted[0]!;
    const leaderboard = sorted.filter((r) => !r.filtered).slice(0, topN);

    res.json({
      strategyId: body.strategyId,
      rows: leaderboard,
      best,
      totalCombos: combos.length,
      kept,
      dropped,
      drawdownFilterPct: ddFilter,
      topN,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------- Shared optimizer helpers ----------------

type OptimizerRow = {
  params: Record<string, number>;
  risk: RiskConfig;
  inSample: ReturnType<typeof runBacktestMetricsOnly>["inSample"];
  outOfSample: ReturnType<typeof runBacktestMetricsOnly>["outOfSample"];
  robustnessScore: number;
  filtered: boolean;
};

function sortOptimizerRows(rows: OptimizerRow[]): OptimizerRow[] {
  return [...rows].sort((a, b) => {
    if (a.filtered !== b.filtered) return a.filtered ? 1 : -1;
    const apyDiff = b.outOfSample.annualReturnPct - a.outOfSample.annualReturnPct;
    if (Math.abs(apyDiff) > 0.01) return apyDiff;
    return b.robustnessScore - a.robustnessScore;
  });
}

async function runOptimizerLoop(
  strat: ReturnType<typeof getStrategy>,
  candles: Awaited<ReturnType<typeof getBtcHistory>>,
  combos: Combo[],
  body: {
    strategyId: string;
    interval: string;
    lookbackDays: number;
    initialCapital: number;
    walkForwardSplit?: number;
  },
  ddFilter: number,
  onProgress:
    | ((done: number, total: number, kept: number, dropped: number) => void)
    | undefined,
): Promise<{ rows: OptimizerRow[]; kept: number; dropped: number }> {
  const rows: OptimizerRow[] = [];
  let kept = 0;
  let dropped = 0;
  // Process in small batches so we yield to the event loop and can stream
  // progress without freezing the server.
  const SLICE = 100;
  for (let i = 0; i < combos.length; i += SLICE) {
    const end = Math.min(i + SLICE, combos.length);
    for (let j = i; j < end; j++) {
      const combo = combos[j]!;
      const r: BacktestRequest = {
        strategyId: body.strategyId,
        params: combo.params,
        interval: body.interval as Interval,
        lookbackDays: body.lookbackDays,
        initialCapital: body.initialCapital,
        risk: combo.risk,
        walkForwardSplit: body.walkForwardSplit,
      };
      const m = runBacktestMetricsOnly(strat!, candles, r);
      // BUG 2 fix: a strategy that "passes" IS but blows up OOS must be
      // dropped — overfit blowups were previously slipping through the
      // leaderboard. Filter on the worse of the two segments.
      const worstDD = Math.max(
        Math.abs(m.inSample.maxDrawdownPct),
        Math.abs(m.outOfSample.maxDrawdownPct),
      );
      const filtered = worstDD > ddFilter;
      if (filtered) dropped++;
      else kept++;
      rows.push({
        params: combo.params,
        risk: combo.risk,
        inSample: m.inSample,
        outOfSample: m.outOfSample,
        robustnessScore: m.robustnessScore,
        filtered,
      });
    }
    if (onProgress) onProgress(end, combos.length, kept, dropped);
    // Yield to event loop between slices so the server stays responsive.
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { rows, kept, dropped };
}

// ---------------- SSE streaming optimizer ----------------

router.post("/backtest/optimize/stream", async (req, res, next) => {
  const parsed = RunOptimizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  const strat = getStrategy(body.strategyId);
  if (!strat) {
    res.status(400).json({ error: `Unknown strategy: ${body.strategyId}` });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let cancelled = false;
  // NOTE: in Express 5 / Node 18+, req.on("close") also fires when the
  // request body is fully received, even on normal completion. Use the
  // response stream instead — it only closes when the socket actually drops.
  res.on("close", () => {
    if (!res.writableEnded) cancelled = true;
  });

  try {
    const srcLabel = body.dataSource === "hyperliquid" ? `Hyperliquid ${body.symbol ?? "BTC"}` : "Binance BTC/USDT";
    send("status", { phase: "fetching", message: `Fetching ${srcLabel} klines…` });
    const candles = await fetchCandles(
      body.dataSource,
      body.symbol,
      body.interval as Interval,
      body.lookbackDays,
    );
    if (candles.length < 100) {
      send("error", {
        message: `Not enough candles fetched (${candles.length}). Try a longer lookback or shorter interval.`,
      });
      res.end();
      return;
    }

    const cap = Math.min(body.maxCombos ?? 10000, 10000);
    const ddFilter = body.maxDrawdownFilterPct ?? 40;
    const topN = Math.max(1, Math.min(body.topN ?? 100, 500));
    const combos = buildCombos(
      body.baseParams,
      body.baseRisk as RiskConfig,
      body.axes.map((a) => ({ key: a.key, values: [...a.values] })),
      cap,
    );

    send("started", {
      totalCombos: combos.length,
      candleCount: candles.length,
      drawdownFilterPct: ddFilter,
      topN,
    });

    const startedAt = Date.now();
    let lastEmit = 0;

    const { rows, kept, dropped } = await runOptimizerLoop(
      strat,
      candles,
      combos,
      body,
      ddFilter,
      (done, total, k, d) => {
        if (cancelled) return;
        const now = Date.now();
        // Throttle to ~5 progress events per second
        if (now - lastEmit < 200 && done < total) return;
        lastEmit = now;
        const elapsedMs = now - startedAt;
        const rate = done > 0 ? done / (elapsedMs / 1000) : 0;
        const remaining = Math.max(0, total - done);
        const etaMs = rate > 0 ? Math.round((remaining / rate) * 1000) : 0;
        send("progress", {
          done,
          total,
          kept: k,
          dropped: d,
          elapsedMs,
          etaMs,
          rate,
        });
      },
    );

    if (cancelled) {
      res.end();
      return;
    }

    const sorted = sortOptimizerRows(rows);
    const best = sorted.find((r) => !r.filtered) ?? sorted[0]!;
    const leaderboard = sorted.filter((r) => !r.filtered).slice(0, topN);

    send("done", {
      strategyId: body.strategyId,
      rows: leaderboard,
      best,
      totalCombos: combos.length,
      kept,
      dropped,
      drawdownFilterPct: ddFilter,
      topN,
      elapsedMs: Date.now() - startedAt,
    });
    res.end();
  } catch (err) {
    try {
      send("error", { message: (err as Error)?.message ?? "Unknown error" });
      res.end();
    } catch {
      next(err);
    }
  }
});

router.post("/backtest/compare", async (req, res, next) => {
  const parsed = CompareStrategiesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  try {
    const results: BacktestResult[] = [];
    // Group by interval+lookbackDays to share fetched candles.
    const byKey = new Map<string, Awaited<ReturnType<typeof getBtcHistory>>>();
    for (const r of parsed.data.requests) {
      const key = `${r.interval}:${r.lookbackDays}`;
      let candles = byKey.get(key);
      if (!candles) {
        candles = await fetchCandles(undefined, undefined, r.interval as Interval, r.lookbackDays);
        byKey.set(key, candles);
      }
      const strat = getStrategy(r.strategyId);
      if (!strat) {
        res.status(400).json({ error: `Unknown strategy: ${r.strategyId}` });
        return;
      }
      results.push(runBacktest(strat, candles, r as BacktestRequest));
    }
    res.json({ results, labels: parsed.data.labels });
  } catch (err) {
    next(err);
  }
});

// ---------------- Tournament: every strategy on the same data ----------------

type TournamentRow = {
  strategyId: string;
  strategyName: string;
  category: string;
  inSample: ReturnType<typeof runBacktestMetricsOnly>["inSample"];
  outOfSample: ReturnType<typeof runBacktestMetricsOnly>["outOfSample"];
  robustnessScore: number;
  filtered: boolean;
  error?: string;
};

function defaultParamsFor(stratId: string): Record<string, number> {
  const s = getStrategy(stratId);
  if (!s) return {};
  const out: Record<string, number> = {};
  for (const p of s.params) out[p.key] = p.default;
  return out;
}

type TournamentBody = {
  interval: string;
  lookbackDays: number;
  initialCapital: number;
  risk: RiskConfig;
  walkForwardSplit?: number;
  walkForwardSplitDate?: string;
  strategyIds?: string[];
  maxDrawdownFilterPct?: number;
};

type TournamentEval = {
  rows: TournamentRow[];
  kept: number;
  dropped: number;
  ids: string[];
  splitDateUsed: string;
};

async function runTournamentLoop(
  body: TournamentBody,
  candles: Awaited<ReturnType<typeof getBtcHistory>>,
  ddFilter: number,
  onRow: ((row: TournamentRow, doneCount: number, total: number) => void) | undefined,
  isCancelled?: () => boolean,
): Promise<TournamentEval> {
  const ids = body.strategyIds && body.strategyIds.length > 0
    ? body.strategyIds.filter((id) => !!getStrategy(id))
    : availableStrategies().map((s) => s.id);

  const rows: TournamentRow[] = [];
  let kept = 0;
  let dropped = 0;

  // OPT 1: yield to event loop in batches of 8 so a long tournament cannot
  // block other API requests for seconds at a time.
  const BATCH = 8;
  for (let start = 0; start < ids.length; start += BATCH) {
    if (isCancelled?.()) break;
    const end = Math.min(start + BATCH, ids.length);
    for (let i = start; i < end; i++) {
      const id = ids[i]!;
      const s = getStrategy(id)!;
      let row: TournamentRow;
      if (s.available === false) {
        row = {
          strategyId: s.id,
          strategyName: s.name,
          category: s.category,
          inSample: emptyTournamentMetrics(),
          outOfSample: emptyTournamentMetrics(),
          robustnessScore: 0,
          filtered: true,
          error: s.unavailableReason ?? "unavailable",
        };
        dropped++;
      } else {
        try {
          const r = {
            strategyId: id,
            params: defaultParamsFor(id),
            interval: body.interval as Interval,
            lookbackDays: body.lookbackDays,
            initialCapital: body.initialCapital,
            risk: body.risk,
            walkForwardSplit: body.walkForwardSplit,
            walkForwardSplitDate: body.walkForwardSplitDate,
          };
          const m = runBacktestMetricsOnly(s, candles, r);
          // BUG 2 fix: a strategy that "passes" IS DD but blows up OOS must
          // not be allowed to win — filter on the worse of the two segments.
          const worstDD = Math.max(
            Math.abs(m.inSample.maxDrawdownPct),
            Math.abs(m.outOfSample.maxDrawdownPct),
          );
          const filtered = worstDD > ddFilter;
          if (filtered) dropped++;
          else kept++;
          row = {
            strategyId: s.id,
            strategyName: s.name,
            category: s.category,
            inSample: m.inSample,
            outOfSample: m.outOfSample,
            robustnessScore: m.robustnessScore,
            filtered,
          };
        } catch (e) {
          dropped++;
          row = {
            strategyId: s.id,
            strategyName: s.name,
            category: s.category,
            inSample: emptyTournamentMetrics(),
            outOfSample: emptyTournamentMetrics(),
            robustnessScore: 0,
            filtered: true,
            error: (e as Error).message,
          };
        }
      }
      rows.push(row);
      onRow?.(row, rows.length, ids.length);
    }
    // Yield between batches so the event loop can serve other requests.
    await new Promise((resolve) => setImmediate(resolve));
  }

  rows.sort((a, b) => {
    if (a.filtered !== b.filtered) return a.filtered ? 1 : -1;
    return b.outOfSample.annualReturnPct - a.outOfSample.annualReturnPct;
  });

  let splitDateUsed = body.walkForwardSplitDate ?? "";
  if (!splitDateUsed) {
    const split = body.walkForwardSplit ?? 0.7;
    const idx = Math.floor(candles.length * split);
    splitDateUsed = candles[Math.min(idx, candles.length - 1)]?.t ?? "";
  }

  return { rows, kept, dropped, ids, splitDateUsed };
}

router.post("/backtest/tournament", async (req, res, next) => {
  const parsed = RunTournamentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  try {
    const candles = await fetchCandles(
      body.dataSource,
      body.symbol,
      body.interval as Interval,
      body.lookbackDays,
    );
    if (candles.length < 100) {
      res.status(400).json({
        error: `Not enough candles fetched (${candles.length}).`,
      });
      return;
    }

    const ddFilter = body.maxDrawdownFilterPct ?? 40;
    const result = await runTournamentLoop(
      body as TournamentBody,
      candles,
      ddFilter,
      undefined,
    );

    const best = result.rows.find((r) => !r.filtered);

    res.json({
      rows: result.rows,
      best,
      totalStrategies: result.ids.length,
      kept: result.kept,
      dropped: result.dropped,
      drawdownFilterPct: ddFilter,
      splitDate: result.splitDateUsed,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------- SSE streaming tournament ----------------

router.post("/backtest/tournament/stream", async (req, res, next) => {
  const parsed = RunTournamentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let cancelled = false;
  res.on("close", () => {
    if (!res.writableEnded) cancelled = true;
  });

  try {
    const srcLabelTmt = body.dataSource === "hyperliquid" ? `Hyperliquid ${body.symbol ?? "BTC"}` : "Binance BTC/USDT";
    send("status", {
      phase: "fetching",
      message: `Fetching ${srcLabelTmt} klines…`,
    });
    const candles = await fetchCandles(
      body.dataSource,
      body.symbol,
      body.interval as Interval,
      body.lookbackDays,
    );
    if (candles.length < 100) {
      send("error", {
        message: `Not enough candles fetched (${candles.length}).`,
      });
      res.end();
      return;
    }

    const ddFilter = body.maxDrawdownFilterPct ?? 40;
    const ids =
      body.strategyIds && body.strategyIds.length > 0
        ? body.strategyIds.filter((id) => !!getStrategy(id))
        : availableStrategies().map((s) => s.id);

    send("started", {
      totalStrategies: ids.length,
      candleCount: candles.length,
      drawdownFilterPct: ddFilter,
    });

    const startedAt = Date.now();
    let lastProgressEmit = 0;

    const evalResult = await runTournamentLoop(
      body as TournamentBody,
      candles,
      ddFilter,
      (row, done, total) => {
        if (cancelled) return;
        send("result", { row, done, total });
        const now = Date.now();
        if (now - lastProgressEmit < 200 && done < total) return;
        lastProgressEmit = now;
        const elapsedMs = now - startedAt;
        const rate = done > 0 ? done / (elapsedMs / 1000) : 0;
        const remaining = Math.max(0, total - done);
        const etaMs = rate > 0 ? Math.round((remaining / rate) * 1000) : 0;
        send("progress", { done, total, elapsedMs, etaMs, rate });
      },
      () => cancelled,
    );

    if (cancelled) {
      res.end();
      return;
    }

    const best = evalResult.rows.find((r) => !r.filtered);
    send("done", {
      rows: evalResult.rows,
      best,
      totalStrategies: evalResult.ids.length,
      kept: evalResult.kept,
      dropped: evalResult.dropped,
      drawdownFilterPct: ddFilter,
      splitDate: evalResult.splitDateUsed,
      elapsedMs: Date.now() - startedAt,
    });
    res.end();
  } catch (err) {
    try {
      send("error", { message: (err as Error)?.message ?? "Unknown error" });
      res.end();
    } catch {
      next(err);
    }
  }
});

// Reuse: void STRATEGIES so tree-shake doesn't drop the registry import
void STRATEGIES;

function emptyTournamentMetrics(): ReturnType<
  typeof runBacktestMetricsOnly
>["inSample"] {
  return {
    totalReturnPct: 0,
    annualReturnPct: 0,
    maxDrawdownPct: 0,
    sharpe: 0,
    sortino: 0,
    winRate: 0,
    profitFactor: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    finalEquity: 0,
    liquidations: 0,
    fundingPaid: 0,
    verdict: "poor" as const,
  };
}

export default router;
