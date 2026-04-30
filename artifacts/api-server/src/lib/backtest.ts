import type {
  Candle,
  Interval,
  Signal,
  StrategyDef,
} from "../types/strategy";
import { INTERVAL_PER_YEAR, INTERVAL_MS } from "../types/strategy";
import { atr, highsArr, lowsArr, closesArr } from "./strategies";

export type RiskConfig = {
  leverage: number;
  atrPeriod: number;
  atrMultiplierSL: number;
  riskRewardRatio: number;
  makerFeePct: number;
  takerFeePct: number;
  slippagePct: number;
  /** % of equity (1–100) committed as margin per trade. Defaults to 100 (legacy all-in). */
  riskPerTradePct?: number;
  /** Perpetual funding rate per 8h, in % (e.g. 0.01). Defaults to 0.01. */
  fundingRatePct8h?: number;
  /** Force-close any position open this many bars or longer. 0 = disabled. */
  maxHoldingBars?: number;
};

export type BacktestRequest = {
  strategyId: string;
  params: Record<string, number>;
  interval: Interval;
  lookbackDays: number;
  initialCapital: number;
  risk: RiskConfig;
  walkForwardSplit?: number;
  walkForwardSplitDate?: string;
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
  fundingPaid: number;
  exitReason:
    | "stop_loss"
    | "take_profit"
    | "signal_exit"
    | "end_of_data"
    | "liquidation"
    | "time_stop";
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
  fundingPaid: number;
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

const INTERVAL_HOURS: Record<Interval, number> = {
  "5m": 5 / 60,
  "15m": 15 / 60,
  "30m": 30 / 60,
  "1h": 1,
  "2h": 2,
  "4h": 4,
  "1d": 24,
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
    fundingPaid: 0,
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
  let fundingPaid = 0;
  for (const t of trades) {
    if (t.exitReason === "liquidation") liquidations++;
    fundingPaid += t.fundingPaid;
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
    fundingPaid: round(fundingPaid, 2),
    verdict,
  };
}

type EngineOutput = {
  trades: Trade[];
  equityCurve: EquityPoint[];
  finalEquity: number;
};

function warmupBarsFor(atrPeriod: number): number {
  // Conservative floor that swallows EMA200/Ichimoku-style warmup noise.
  return Math.max(atrPeriod * 3, 50);
}

/**
 * Realistic exchange execution engine.
 *
 * Per-bar order:
 *   1. If position is open from a previous bar, check exits in this order:
 *        liquidation > stop loss > take profit > time-stop > signal flip
 *      This is conservative (worst case wins ties intra-bar).
 *   2. If flat and current bar's signal != 0, OPEN at this bar's close
 *      (with slippage + taker fee). The ATR used for SL is the ATR computed
 *      THROUGH this bar (no look-ahead — ATR uses past+current bar OHLC).
 *      Position is then managed starting from the NEXT bar.
 *
 * Same-bar reversals (signal flips long↔short) pay 1.5× normal slippage on
 * the re-entry to penalize the unrealistic "instant flip at close" behavior.
 *
 * Funding (perpetual futures) is deducted from equity every time a held
 * position crosses an 8-hour boundary, scaled by `fundingRatePct8h`.
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
  interval: Interval,
): EngineOutput {
  const lev = Math.max(1, risk.leverage);
  const slip = risk.slippagePct / 100;
  const taker = risk.takerFeePct / 100;
  const maker = risk.makerFeePct / 100;
  const liqBuffer = 0.005;
  const liqMoveThreshold = 1 / lev - liqBuffer;
  const riskPct = Math.min(100, Math.max(1, risk.riskPerTradePct ?? 100)) / 100;
  const fundingRate = Math.max(0, risk.fundingRatePct8h ?? 0.01) / 100;
  const maxHoldBars = Math.max(0, Math.floor(risk.maxHoldingBars ?? 0));
  const intervalHours = INTERVAL_HOURS[interval];

  let equity = startEquity;
  let peak = startEquity;
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  let pos: Signal = 0;
  let entryPrice = 0;
  let entryTime = "";
  let entryBar = -1;
  let lastFundingPeriods = 0;
  let stopPrice = 0;
  let tpPrice = 0;
  let liqPrice = 0;
  let marginAtRisk = 0;
  let entryFee = 0;
  let positionFundingAccrued = 0;

  function applyFundingThroughBar(barIdx: number): void {
    if (pos === 0 || entryBar < 0 || fundingRate <= 0) return;
    const hoursHeld = intervalHours * (barIdx - entryBar);
    const fundingPeriods = Math.floor(hoursHeld / 8);
    const newPeriods = fundingPeriods - lastFundingPeriods;
    if (newPeriods > 0) {
      const notional = marginAtRisk * lev;
      const cost = notional * fundingRate * newPeriods;
      const charged = Math.min(equity, cost);
      equity = Math.max(0, equity - cost);
      positionFundingAccrued += charged;
      lastFundingPeriods = fundingPeriods;
    }
  }

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
      // stop_loss / signal_exit / end_of_data / time_stop — market order
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
    // realized = post-funding equity delta
    const realizedPnl = newEquity - equity;
    const pnlPct = marginAtRisk > 0 ? (realizedPnl / marginAtRisk) * 100 : 0;

    trades.push({
      entryTime,
      exitTime: barTime,
      side: pos === 1 ? "long" : "short",
      entryPrice: round(entryPrice, 2),
      exitPrice: round(exitPx, 2),
      stopPrice: round(stopPrice, 2),
      takeProfitPrice: round(tpPrice, 2),
      pnl: round(realizedPnl, 2),
      pnlPct: round(pnlPct, 4),
      feePaid: round(entryFee + exitFee, 2),
      fundingPaid: round(positionFundingAccrued, 4),
      exitReason: reason,
      sample,
    });

    equity = newEquity;
    pos = 0;
    entryPrice = 0;
    entryTime = "";
    entryBar = -1;
    lastFundingPeriods = 0;
    stopPrice = 0;
    tpPrice = 0;
    liqPrice = 0;
    marginAtRisk = 0;
    entryFee = 0;
    positionFundingAccrued = 0;
  }

  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i];
    if (!c) continue;

    const prevPos: Signal = pos;

    // Apply any funding cycles crossed before evaluating this bar's exits.
    applyFundingThroughBar(i);

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

      // Time-stop — close at market if held >= maxHoldBars.
      if (
        !exited &&
        maxHoldBars > 0 &&
        entryBar >= 0 &&
        i - entryBar >= maxHoldBars
      ) {
        closePosition(c.t, c.c, "time_stop");
        exited = true;
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
      // Same-bar reversal penalty: if we just closed a position this bar with
      // the opposite signal, charge 1.5× slippage on the re-entry.
      const isReversal = prevPos !== 0 && sig !== prevPos;
      const slipMultiplier = isReversal ? 1.5 : 1.0;
      const effectiveSlip = slip * slipMultiplier;
      const slipMult = sig === 1 ? 1 + effectiveSlip : 1 - effectiveSlip;
      const entryPx = c.c * slipMult;
      const slDist = atrVal * risk.atrMultiplierSL;
      const tpDist = slDist * risk.riskRewardRatio;

      pos = sig;
      entryPrice = entryPx;
      entryTime = c.t;
      entryBar = i;
      lastFundingPeriods = 0;
      positionFundingAccrued = 0;
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
      marginAtRisk = equity * riskPct;
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
      applyFundingThroughBar(endIdx);
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

function splitIndex(
  candles: Candle[],
  split: number,
  atrPeriod: number,
  splitDate?: string,
): number {
  // Use the same warmup floor as runEngine so the IS window starts somewhere
  // useful even with very long warmups (EMA200 etc).
  const minStart = warmupBarsFor(atrPeriod);
  const maxIdx = candles.length - 5;
  if (splitDate && candles.length > 0) {
    const target = Date.parse(splitDate);
    if (Number.isFinite(target)) {
      // Find the first candle whose timestamp >= target. Everything before it
      // is in-sample, everything from it onward is out-of-sample.
      let idx = candles.findIndex((c) => Date.parse(c.t) >= target);
      if (idx < 0) idx = candles.length - 1;
      // Convert to in-sample-end index (last in-sample bar).
      idx = Math.max(0, idx - 1);
      return Math.min(Math.max(idx, minStart), maxIdx);
    }
  }
  const s = Math.min(0.9, Math.max(0.3, split));
  const idx = Math.floor(candles.length * s);
  return Math.min(Math.max(idx, minStart), maxIdx);
}

function computeRobustness(
  isAPY: number,
  oosAPY: number,
): number {
  // Bounded 0–1: geometric mean of consistency (OOS/IS) and OOS absolute
  // quality (normalized to 200% APY ceiling). Non-positive OOS → 0 unless IS
  // was also non-positive (give a neutral floor).
  const consistencyRatio =
    isAPY > 0
      ? Math.min(Math.max(oosAPY / isAPY, 0), 3) / 3
      : oosAPY >= 0
        ? 0.33
        : 0;
  const oosQuality = Math.max(0, Math.min(oosAPY / 200, 1));
  return round(Math.sqrt(consistencyRatio * oosQuality), 3);
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

  const sIdx = splitIndex(
    candles,
    req.walkForwardSplit ?? 0.7,
    atrPeriod,
    req.walkForwardSplitDate,
  );
  const warmup = warmupBarsFor(atrPeriod);
  const isStart = Math.min(Math.max(warmup, 1), Math.max(0, sIdx - 1));

  const isOut = runEngine(
    candles,
    signals,
    atrSeries,
    isStart,
    sIdx,
    req.initialCapital,
    req.risk,
    "in_sample",
    req.interval,
  );

  // OOS engine still inherits IS final equity (capital compounds) but
  // metrics are computed against req.initialCapital so % returns are
  // comparable across strategies regardless of whether IS made or lost money.
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
    req.interval,
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
    req.initialCapital, // ← BUG 3 fix: always use req.initialCapital so OOS APY % is comparable.
    req.interval,
  );

  const robustness = computeRobustness(
    isMetrics.annualReturnPct,
    oosMetrics.annualReturnPct,
  );

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
  splitDate: string;
} {
  const signals = strategy.generateSignals(candles, req.params);
  const h = highsArr(candles);
  const l = lowsArr(candles);
  const c = closesArr(candles);
  const atrPeriod = Math.max(2, Math.round(req.risk.atrPeriod));
  const atrSeries = atr(h, l, c, atrPeriod);
  const sIdx = splitIndex(
    candles,
    req.walkForwardSplit ?? 0.7,
    atrPeriod,
    req.walkForwardSplitDate,
  );
  const warmup = warmupBarsFor(atrPeriod);
  const isStart = Math.min(Math.max(warmup, 1), Math.max(0, sIdx - 1));

  const isOut = runEngine(
    candles,
    signals,
    atrSeries,
    isStart,
    sIdx,
    req.initialCapital,
    req.risk,
    "in_sample",
    req.interval,
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
    req.initialCapital, // ← BUG 3 fix
    req.interval,
  );
  const robustnessScore = computeRobustness(
    isMetrics.annualReturnPct,
    oosMetrics.annualReturnPct,
  );
  return {
    inSample: isMetrics,
    outOfSample: oosMetrics,
    robustnessScore,
    splitDate: candles[sIdx]?.t ?? candles[0]?.t ?? "",
  };
}

// re-export for clarity / consumers that want INTERVAL_MS without re-importing
// strategy types.
export { INTERVAL_MS };
