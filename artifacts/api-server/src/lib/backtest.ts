import type {
  Candle,
  Interval,
  Signal,
  StrategyDef,
} from "../types/strategy";
import { INTERVAL_PER_YEAR } from "../types/strategy";
import { atr, highsArr, lowsArr, closesArr } from "./strategies";

export type RiskConfig = {
  leverage: number;
  atrPeriod: number;
  atrMultiplierSL: number;
  riskRewardRatio: number;
  makerFeePct: number;
  takerFeePct: number;
  slippagePct: number;
};

export type BacktestRequest = {
  strategyId: string;
  params: Record<string, number>;
  interval: Interval;
  lookbackDays: number;
  initialCapital: number;
  risk: RiskConfig;
  walkForwardSplit?: number;
};

export type Trade = {
  entryTime: string;
  exitTime: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  takeProfitPrice: number;
  pnl: number;
  pnlPct: number;
  feePaid: number;
  exitReason:
    | "stop_loss"
    | "take_profit"
    | "signal_exit"
    | "end_of_data"
    | "liquidation";
  sample: "in_sample" | "out_of_sample";
};

export type EquityPoint = { t: string; equity: number; drawdown: number };

export type BacktestMetrics = {
  totalReturnPct: number;
  annualReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  sortino: number;
  winRate: number;
  profitFactor: number;
  trades: number;
  wins: number;
  losses: number;
  avgWinPct: number;
  avgLossPct: number;
  finalEquity: number;
  liquidations: number;
  verdict: "excellent" | "good" | "mediocre" | "poor" | "blown";
};

export type WalkForwardSummary = {
  splitDate: string;
  inSample: BacktestMetrics;
  outOfSample: BacktestMetrics;
  robustnessScore: number;
};

export type BacktestResult = {
  strategyId: string;
  request: BacktestRequest;
  metrics: BacktestMetrics;
  walkForward: WalkForwardSummary;
  equityCurve: EquityPoint[];
  trades: Trade[];
  candles: Candle[];
};

function round(n: number, d = 4): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function emptyMetrics(initialCapital: number): BacktestMetrics {
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
    finalEquity: initialCapital,
    liquidations: 0,
    verdict: "poor",
  };
}

function computeMetrics(
  trades: Trade[],
  equityCurve: EquityPoint[],
  initialCapital: number,
  interval: Interval,
): BacktestMetrics {
  if (equityCurve.length === 0) return emptyMetrics(initialCapital);
  const finalEq = equityCurve[equityCurve.length - 1]!.equity;
  const totalReturnPct = (finalEq / initialCapital - 1) * 100;
  const periodsPerYear = INTERVAL_PER_YEAR[interval];
  const periods = equityCurve.length;
  const years = periods / periodsPerYear;
  const annualReturnPct =
    finalEq > 0 && years > 0
      ? (Math.pow(finalEq / initialCapital, 1 / years) - 1) * 100
      : -100;

  let maxDD = 0;
  for (const p of equityCurve) maxDD = Math.min(maxDD, p.drawdown);

  const rets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) rets.push(cur / prev - 1);
  }
  let mean = 0;
  for (const r of rets) mean += r;
  mean = rets.length > 0 ? mean / rets.length : 0;
  let variance = 0;
  let downsideSq = 0;
  for (const r of rets) {
    variance += (r - mean) ** 2;
    if (r < 0) downsideSq += r * r;
  }
  const std = rets.length > 0 ? Math.sqrt(variance / rets.length) : 0;
  const downside = rets.length > 0 ? Math.sqrt(downsideSq / rets.length) : 0;
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(periodsPerYear) : 0;
  const sortino =
    downside > 0 ? (mean / downside) * Math.sqrt(periodsPerYear) : 0;

  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let sumWinPct = 0;
  let sumLossPct = 0;
  let liquidations = 0;
  for (const t of trades) {
    if (t.exitReason === "liquidation") liquidations++;
    if (t.pnl > 0) {
      wins++;
      grossWin += t.pnl;
      sumWinPct += t.pnlPct;
    } else {
      losses++;
      grossLoss += Math.abs(t.pnl);
      sumLossPct += t.pnlPct;
    }
  }
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : wins > 0 ? 99 : 0;
  const avgWinPct = wins > 0 ? sumWinPct / wins : 0;
  const avgLossPct = losses > 0 ? sumLossPct / losses : 0;

  let verdict: BacktestMetrics["verdict"];
  if (finalEq <= initialCapital * 0.05) verdict = "blown";
  else if (annualReturnPct >= 200 && maxDD > -60 && sharpe > 1)
    verdict = "excellent";
  else if (annualReturnPct >= 50 && maxDD > -50) verdict = "good";
  else if (annualReturnPct >= 0) verdict = "mediocre";
  else verdict = "poor";

  return {
    totalReturnPct: round(totalReturnPct, 2),
    annualReturnPct: round(annualReturnPct, 2),
    maxDrawdownPct: round(maxDD, 2),
    sharpe: round(sharpe, 3),
    sortino: round(sortino, 3),
    winRate: round(winRate, 2),
    profitFactor: round(profitFactor, 3),
    trades: trades.length,
    wins,
    losses,
    avgWinPct: round(avgWinPct, 3),
    avgLossPct: round(avgLossPct, 3),
    finalEquity: round(finalEq, 2),
    liquidations,
    verdict,
  };
}

type EngineOutput = {
  trades: Trade[];
  equityCurve: EquityPoint[];
  finalEquity: number;
};

/**
 * Realistic exchange execution engine.
 *
 * Per-bar order:
 *   1. If position is open from a previous bar, check exits in this order:
 *        liquidation > stop loss > take profit > signal flip
 *      This is conservative (worst case wins ties intra-bar).
 *   2. If flat and current bar's signal != 0, OPEN at this bar's close
 *      (with slippage + taker fee). The ATR used for SL is the ATR computed
 *      THROUGH this bar (no look-ahead — ATR uses past+current bar OHLC).
 *      Position is then managed starting from the NEXT bar.
 */
function runEngine(
  candles: Candle[],
  signals: Signal[],
  atrSeries: Float64Array,
  startIdx: number,
  endIdx: number,
  startEquity: number,
  risk: RiskConfig,
  sample: Trade["sample"],
): EngineOutput {
  const lev = Math.max(1, risk.leverage);
  const slip = risk.slippagePct / 100;
  const taker = risk.takerFeePct / 100;
  const maker = risk.makerFeePct / 100;
  const liqBuffer = 0.005;
  const liqMoveThreshold = 1 / lev - liqBuffer;

  let equity = startEquity;
  let peak = startEquity;
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  let pos: Signal = 0;
  let entryPrice = 0;
  let entryTime = "";
  let stopPrice = 0;
  let tpPrice = 0;
  let liqPrice = 0;
  let marginAtRisk = 0;
  let entryFee = 0;

  function closePosition(
    barTime: string,
    rawExitPrice: number,
    reason: Trade["exitReason"],
  ): void {
    if (pos === 0 || entryPrice <= 0) return;
    let exitPx = rawExitPrice;
    let exitFeeRate = taker;
    if (reason === "take_profit") {
      // limit order fill — maker fee, no slippage
      exitFeeRate = maker;
    } else if (reason === "liquidation") {
      // already at the threshold price; no further slippage modeled
      exitFeeRate = taker;
    } else {
      // stop_loss / signal_exit / end_of_data — market order
      const slipMult = pos === 1 ? 1 - slip : 1 + slip;
      exitPx = rawExitPrice * slipMult;
    }

    const move = (exitPx - entryPrice) / entryPrice;
    const directional = pos === 1 ? move : -move;
    const notional = marginAtRisk * lev;

    let grossPnl: number;
    if (reason === "liquidation") {
      grossPnl = -marginAtRisk; // margin wiped
    } else {
      grossPnl = marginAtRisk * directional * lev;
      // cap loss at margin (cannot lose more than what was put up)
      if (grossPnl < -marginAtRisk) grossPnl = -marginAtRisk;
    }

    const exitFee = notional * exitFeeRate;
    const newEquity = Math.max(0, equity + grossPnl - exitFee);
    const netPnl = newEquity - marginAtRisk;
    const pnlPct = marginAtRisk > 0 ? (netPnl / marginAtRisk) * 100 : 0;

    trades.push({
      entryTime,
      exitTime: barTime,
      side: pos === 1 ? "long" : "short",
      entryPrice: round(entryPrice, 2),
      exitPrice: round(exitPx, 2),
      stopPrice: round(stopPrice, 2),
      takeProfitPrice: round(tpPrice, 2),
      pnl: round(netPnl, 2),
      pnlPct: round(pnlPct, 4),
      feePaid: round(entryFee + exitFee, 2),
      exitReason: reason,
      sample,
    });

    equity = newEquity;
    pos = 0;
    entryPrice = 0;
    entryTime = "";
    stopPrice = 0;
    tpPrice = 0;
    liqPrice = 0;
    marginAtRisk = 0;
    entryFee = 0;
  }

  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i];
    if (!c) continue;

    // Manage already-open position using THIS bar's high/low.
    if (pos !== 0 && entryPrice > 0) {
      let exited = false;
      if (pos === 1) {
        if (c.l <= liqPrice) {
          closePosition(c.t, liqPrice, "liquidation");
          exited = true;
        } else if (c.l <= stopPrice) {
          closePosition(c.t, stopPrice, "stop_loss");
          exited = true;
        } else if (c.h >= tpPrice) {
          closePosition(c.t, tpPrice, "take_profit");
          exited = true;
        }
      } else {
        if (c.h >= liqPrice) {
          closePosition(c.t, liqPrice, "liquidation");
          exited = true;
        } else if (c.h >= stopPrice) {
          closePosition(c.t, stopPrice, "stop_loss");
          exited = true;
        } else if (c.l <= tpPrice) {
          closePosition(c.t, tpPrice, "take_profit");
          exited = true;
        }
      }
      // Signal flip — close at this bar's close.
      const sig = signals[i] ?? 0;
      if (!exited && sig !== pos) {
        closePosition(c.t, c.c, "signal_exit");
      }
    }

    // Open new position at this bar's close (signal known at bar close).
    const sig = signals[i] ?? 0;
    const atrVal = atrSeries[i] ?? 0;
    if (pos === 0 && sig !== 0 && equity > 0 && atrVal > 0 && i < endIdx) {
      const slipMult = sig === 1 ? 1 + slip : 1 - slip;
      const entryPx = c.c * slipMult;
      const slDist = atrVal * risk.atrMultiplierSL;
      const tpDist = slDist * risk.riskRewardRatio;

      pos = sig;
      entryPrice = entryPx;
      entryTime = c.t;
      if (sig === 1) {
        stopPrice = entryPx - slDist;
        tpPrice = entryPx + tpDist;
        liqPrice = entryPx * (1 - liqMoveThreshold);
        if (stopPrice < liqPrice) stopPrice = liqPrice + 1e-6;
      } else {
        stopPrice = entryPx + slDist;
        tpPrice = entryPx - tpDist;
        liqPrice = entryPx * (1 + liqMoveThreshold);
        if (stopPrice > liqPrice) stopPrice = liqPrice - 1e-6;
      }
      marginAtRisk = equity;
      const notional = marginAtRisk * lev;
      entryFee = notional * taker;
      equity = Math.max(0, equity - entryFee);
    }

    // Mark-to-market equity at bar close.
    let mtm = equity;
    if (pos !== 0 && entryPrice > 0) {
      const move = (c.c - entryPrice) / entryPrice;
      const directional = pos === 1 ? move : -move;
      const unrealized = marginAtRisk * directional * lev;
      mtm = Math.max(0, equity + unrealized);
    }
    peak = Math.max(peak, mtm);
    const dd = peak > 0 ? ((mtm - peak) / peak) * 100 : 0;
    equityCurve.push({
      t: c.t,
      equity: round(mtm, 2),
      drawdown: round(dd, 4),
    });
  }

  // Force-close at end of segment.
  if (pos !== 0 && entryPrice > 0) {
    const last = candles[endIdx];
    if (last) {
      closePosition(last.t, last.c, "end_of_data");
      // Replace last equity point to reflect final settled equity.
      const ec = equityCurve[equityCurve.length - 1];
      if (ec) {
        peak = Math.max(peak, equity);
        const dd = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
        equityCurve[equityCurve.length - 1] = {
          t: ec.t,
          equity: round(equity, 2),
          drawdown: round(dd, 4),
        };
      }
    }
  }

  return { trades, equityCurve, finalEquity: equity };
}

function splitIndex(candles: Candle[], split: number, atrPeriod: number): number {
  const s = Math.min(0.9, Math.max(0.3, split));
  const idx = Math.floor(candles.length * s);
  const minStart = atrPeriod * 2 + 5;
  return Math.min(Math.max(idx, minStart), candles.length - 5);
}

export function runBacktest(
  strategy: StrategyDef,
  candles: Candle[],
  req: BacktestRequest,
): BacktestResult {
  const signals = strategy.generateSignals(candles, req.params);
  const h = highsArr(candles);
  const l = lowsArr(candles);
  const c = closesArr(candles);
  const atrPeriod = Math.max(2, Math.round(req.risk.atrPeriod));
  const atrSeries = atr(h, l, c, atrPeriod);

  const sIdx = splitIndex(candles, req.walkForwardSplit ?? 0.7, atrPeriod);

  const isOut = runEngine(
    candles,
    signals,
    atrSeries,
    Math.max(atrPeriod, 1),
    sIdx,
    req.initialCapital,
    req.risk,
    "in_sample",
  );

  const oosStartEquity =
    isOut.finalEquity > 0 ? isOut.finalEquity : req.initialCapital;
  const oosOut = runEngine(
    candles,
    signals,
    atrSeries,
    sIdx + 1,
    candles.length - 1,
    oosStartEquity,
    req.risk,
    "out_of_sample",
  );

  const allTrades = [...isOut.trades, ...oosOut.trades];
  const allCurve = [...isOut.equityCurve, ...oosOut.equityCurve];

  const overallMetrics = computeMetrics(
    allTrades,
    allCurve,
    req.initialCapital,
    req.interval,
  );
  const isMetrics = computeMetrics(
    isOut.trades,
    isOut.equityCurve,
    req.initialCapital,
    req.interval,
  );
  const oosMetrics = computeMetrics(
    oosOut.trades,
    oosOut.equityCurve,
    oosStartEquity,
    req.interval,
  );

  const robustness =
    isMetrics.annualReturnPct > 0
      ? round(oosMetrics.annualReturnPct / isMetrics.annualReturnPct, 3)
      : oosMetrics.annualReturnPct >= 0
        ? 1
        : 0;

  return {
    strategyId: strategy.id,
    request: req,
    metrics: overallMetrics,
    walkForward: {
      splitDate: candles[sIdx]?.t ?? candles[0]?.t ?? "",
      inSample: isMetrics,
      outOfSample: oosMetrics,
      robustnessScore: robustness,
    },
    equityCurve: allCurve,
    trades: allTrades,
    candles,
  };
}

export function runBacktestMetricsOnly(
  strategy: StrategyDef,
  candles: Candle[],
  req: BacktestRequest,
): {
  inSample: BacktestMetrics;
  outOfSample: BacktestMetrics;
  robustnessScore: number;
} {
  const signals = strategy.generateSignals(candles, req.params);
  const h = highsArr(candles);
  const l = lowsArr(candles);
  const c = closesArr(candles);
  const atrPeriod = Math.max(2, Math.round(req.risk.atrPeriod));
  const atrSeries = atr(h, l, c, atrPeriod);
  const sIdx = splitIndex(candles, req.walkForwardSplit ?? 0.7, atrPeriod);

  const isOut = runEngine(
    candles,
    signals,
    atrSeries,
    Math.max(atrPeriod, 1),
    sIdx,
    req.initialCapital,
    req.risk,
    "in_sample",
  );
  const oosStart =
    isOut.finalEquity > 0 ? isOut.finalEquity : req.initialCapital;
  const oosOut = runEngine(
    candles,
    signals,
    atrSeries,
    sIdx + 1,
    candles.length - 1,
    oosStart,
    req.risk,
    "out_of_sample",
  );
  const isMetrics = computeMetrics(
    isOut.trades,
    isOut.equityCurve,
    req.initialCapital,
    req.interval,
  );
  const oosMetrics = computeMetrics(
    oosOut.trades,
    oosOut.equityCurve,
    oosStart,
    req.interval,
  );
  const robustnessScore =
    isMetrics.annualReturnPct > 0
      ? round(oosMetrics.annualReturnPct / isMetrics.annualReturnPct, 3)
      : oosMetrics.annualReturnPct >= 0
        ? 1
        : 0;
  return { inSample: isMetrics, outOfSample: oosMetrics, robustnessScore };
}
