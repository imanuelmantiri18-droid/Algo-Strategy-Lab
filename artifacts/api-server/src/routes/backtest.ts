import { Router, type IRouter } from "express";
import {
  RunBacktestBody,
  RunOptimizationBody,
  CompareStrategiesBody,
} from "@workspace/api-zod";
import { getStrategy } from "../lib/strategies";
import { getBtcHistory } from "../lib/marketData";
import { runBacktest, type BacktestRequest, type BacktestResult } from "../lib/backtest";

const router: IRouter = Router();

function execute(req: BacktestRequest): BacktestResult | { error: string } {
  const strat = getStrategy(req.strategyId);
  if (!strat) return { error: `Unknown strategy: ${req.strategyId}` };
  const candles = getBtcHistory(req.days);
  return runBacktest(strat, candles, req);
}

router.post("/backtest/run", (req, res) => {
  const parsed = RunBacktestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const out = execute(parsed.data as BacktestRequest);
  if ("error" in out) {
    res.status(400).json(out);
    return;
  }
  res.json(out);
});

router.post("/backtest/optimize", (req, res) => {
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
  const candles = getBtcHistory(body.days);
  const rows: Array<{
    leverage: number;
    stopLossPct: number;
    takeProfitPct: number;
    metrics: BacktestResult["metrics"];
  }> = [];

  const levGrid = body.leverageGrid.length > 0 ? body.leverageGrid : [1];
  const slGrid = body.stopLossGrid.length > 0 ? body.stopLossGrid : [5];
  const tpGrid = body.takeProfitGrid.length > 0 ? body.takeProfitGrid : [10];

  const cap = Math.min(levGrid.length * slGrid.length * tpGrid.length, 200);
  let count = 0;
  for (const lev of levGrid) {
    for (const sl of slGrid) {
      for (const tp of tpGrid) {
        if (count >= cap) break;
        count++;
        const r: BacktestRequest = {
          strategyId: body.strategyId,
          params: body.params,
          leverage: lev,
          stopLossPct: sl,
          takeProfitPct: tp,
          days: body.days,
          initialCapital: body.initialCapital,
          feePct: body.feePct ?? 0.06,
        };
        const result = runBacktest(strat, candles, r);
        rows.push({
          leverage: lev,
          stopLossPct: sl,
          takeProfitPct: tp,
          metrics: result.metrics,
        });
      }
    }
  }

  rows.sort((a, b) => {
    if (b.metrics.verdict === "blown" && a.metrics.verdict !== "blown") return -1;
    if (a.metrics.verdict === "blown" && b.metrics.verdict !== "blown") return 1;
    return b.metrics.annualReturnPct - a.metrics.annualReturnPct;
  });

  const best = rows[0] ?? {
    leverage: 1,
    stopLossPct: 0,
    takeProfitPct: 0,
    metrics: {
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
      finalEquity: body.initialCapital,
      liquidations: 0,
      verdict: "poor" as const,
    },
  };

  res.json({ strategyId: body.strategyId, rows, best });
});

router.post("/backtest/compare", (req, res) => {
  const parsed = CompareStrategiesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const results: BacktestResult[] = [];
  for (const r of parsed.data.requests) {
    const out = execute(r as BacktestRequest);
    if ("error" in out) {
      res.status(400).json(out);
      return;
    }
    results.push(out);
  }
  res.json({ results });
});

export default router;
