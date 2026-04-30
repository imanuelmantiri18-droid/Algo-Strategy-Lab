import { Router, type IRouter } from "express";
import {
  RunBacktestBody,
  RunOptimizationBody,
  CompareStrategiesBody,
} from "@workspace/api-zod";
import { getStrategy } from "../lib/strategies";
import { getBtcHistory } from "../lib/marketData";
import {
  runBacktest,
  runBacktestMetricsOnly,
  type BacktestRequest,
  type BacktestResult,
  type RiskConfig,
} from "../lib/backtest";
import type { Interval } from "../types/strategy";

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
    const candles = await getBtcHistory(
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
    res.json(result);
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
]);

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
    const candles = await getBtcHistory(
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
    const combos = buildCombos(
      body.baseParams,
      body.baseRisk as RiskConfig,
      body.axes.map((a) => ({ key: a.key, values: [...a.values] })),
      cap,
    );

    const rows: Array<{
      params: Record<string, number>;
      risk: RiskConfig;
      inSample: ReturnType<typeof runBacktestMetricsOnly>["inSample"];
      outOfSample: ReturnType<typeof runBacktestMetricsOnly>["outOfSample"];
      robustnessScore: number;
      filtered: boolean;
    }> = [];
    let kept = 0;
    let dropped = 0;

    // Run backtests in slices, yielding to the event loop so we don't block other requests.
    const SLICE = 32;
    for (let i = 0; i < combos.length; i += SLICE) {
      const slice = combos.slice(i, i + SLICE);
      for (const combo of slice) {
        const r: BacktestRequest = {
          strategyId: body.strategyId,
          params: combo.params,
          interval: body.interval as Interval,
          lookbackDays: body.lookbackDays,
          initialCapital: body.initialCapital,
          risk: combo.risk,
          walkForwardSplit: body.walkForwardSplit,
        };
        const m = runBacktestMetricsOnly(strat, candles, r);
        const filtered = Math.abs(m.inSample.maxDrawdownPct) > ddFilter;
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
      // Yield to event loop between slices.
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Sort: kept rows first, then by OOS APY, robustness as tiebreaker.
    rows.sort((a, b) => {
      if (a.filtered !== b.filtered) return a.filtered ? 1 : -1;
      const apyDiff = b.outOfSample.annualReturnPct - a.outOfSample.annualReturnPct;
      if (Math.abs(apyDiff) > 0.01) return apyDiff;
      return b.robustnessScore - a.robustnessScore;
    });

    const best = rows.find((r) => !r.filtered) ?? rows[0]!;

    res.json({
      strategyId: body.strategyId,
      rows,
      best,
      totalCombos: combos.length,
      kept,
      dropped,
      drawdownFilterPct: ddFilter,
    });
  } catch (err) {
    next(err);
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
        candles = await getBtcHistory(r.interval as Interval, r.lookbackDays);
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

export default router;
