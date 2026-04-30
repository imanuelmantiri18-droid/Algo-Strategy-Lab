import type { Candle, Signal, StrategyDef } from "../types/strategy";

export type BacktestRequest = {
  strategyId: string;
  params: Record<string, number>;
  leverage: number;
  stopLossPct: number;
  takeProfitPct: number;
  days: number;
  initialCapital: number;
  feePct?: number;
};

export type Trade = {
  entryTime: string;
  exitTime: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  exitReason: "stop_loss" | "take_profit" | "signal_exit" | "end_of_data" | "liquidation";
};

export type EquityPoint = {
  t: string;
  equity: number;
  drawdown: number;
};

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

export type BacktestResult = {
  strategyId: string;
  request: BacktestRequest;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: Trade[];
  candles: Candle[];
};

function round(n: number, d = 4): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

export function runBacktest(
  strategy: StrategyDef,
  candles: Candle[],
  req: BacktestRequest,
): BacktestResult {
  const signals: Signal[] = strategy.generateSignals(candles, req.params);
  const fee = (req.feePct ?? 0.06) / 100;
  const lev = Math.max(1, req.leverage);
  const sl = req.stopLossPct / 100;
  const tp = req.takeProfitPct / 100;

  let equity = req.initialCapital;
  let peak = equity;
  const equityCurve: EquityPoint[] = [];
  const trades: Trade[] = [];

  let pos: Signal = 0;
  let entryPrice = 0;
  let entryTime = "";
  let liquidations = 0;
  const liqBuffer = 0.05;
  const liqThreshold = 1 / lev - liqBuffer;

  function closeTrade(
    candle: Candle,
    exitPrice: number,
    reason: Trade["exitReason"],
  ) {
    if (pos === 0 || entryPrice <= 0) return;
    const rawMove = (exitPrice - entryPrice) / entryPrice;
    const directional = pos === 1 ? rawMove : -rawMove;
    let leveragedReturn = directional * lev;
    if (reason === "liquidation") {
      leveragedReturn = -1;
      liquidations++;
    }
    const feeCost = 2 * fee * lev;
    const netReturn = Math.max(-1, leveragedReturn - feeCost);
    const pnl = equity * netReturn;
    equity = Math.max(0, equity + pnl);
    trades.push({
      entryTime,
      exitTime: candle.t,
      side: pos === 1 ? "long" : "short",
      entryPrice: round(entryPrice, 2),
      exitPrice: round(exitPrice, 2),
      pnl: round(pnl, 2),
      pnlPct: round(netReturn * 100, 4),
      exitReason: reason,
    });
    pos = 0;
    entryPrice = 0;
    entryTime = "";
  }

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    const sig = signals[i] ?? 0;

    if (pos !== 0 && entryPrice > 0) {
      const moveHigh = (c.h - entryPrice) / entryPrice;
      const moveLow = (c.l - entryPrice) / entryPrice;
      let exited = false;

      if (pos === 1) {
        const adverse = -moveLow;
        if (adverse >= liqThreshold) {
          closeTrade(c, entryPrice * (1 - liqThreshold), "liquidation");
          exited = true;
        } else if (-moveLow >= sl) {
          closeTrade(c, entryPrice * (1 - sl), "stop_loss");
          exited = true;
        } else if (moveHigh >= tp) {
          closeTrade(c, entryPrice * (1 + tp), "take_profit");
          exited = true;
        }
      } else {
        const adverse = moveHigh;
        if (adverse >= liqThreshold) {
          closeTrade(c, entryPrice * (1 + liqThreshold), "liquidation");
          exited = true;
        } else if (moveHigh >= sl) {
          closeTrade(c, entryPrice * (1 + sl), "stop_loss");
          exited = true;
        } else if (-moveLow >= tp) {
          closeTrade(c, entryPrice * (1 - tp), "take_profit");
          exited = true;
        }
      }

      if (!exited && sig !== pos) {
        closeTrade(c, c.c, "signal_exit");
      }
    }

    if (pos === 0 && sig !== 0 && equity > 0) {
      pos = sig;
      entryPrice = c.c;
      entryTime = c.t;
    }

    let mtm = equity;
    if (pos !== 0 && entryPrice > 0) {
      const move = (c.c - entryPrice) / entryPrice;
      const directional = pos === 1 ? move : -move;
      mtm = Math.max(0, equity * (1 + directional * lev - 2 * fee * lev));
    }

    peak = Math.max(peak, mtm);
    const dd = peak > 0 ? (mtm - peak) / peak : 0;
    equityCurve.push({
      t: c.t,
      equity: round(mtm, 2),
      drawdown: round(dd * 100, 4),
    });
  }

  if (pos !== 0 && entryPrice > 0) {
    const last = candles[candles.length - 1];
    if (last) closeTrade(last, last.c, "end_of_data");
  }

  const finalEq = equityCurve[equityCurve.length - 1]?.equity ?? equity;
  const totalReturnPct = (finalEq / req.initialCapital - 1) * 100;
  const years = candles.length / 365;
  const annualReturnPct =
    finalEq > 0 && years > 0
      ? (Math.pow(finalEq / req.initialCapital, 1 / years) - 1) * 100
      : -100;

  let maxDD = 0;
  for (const p of equityCurve) maxDD = Math.min(maxDD, p.drawdown);

  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]?.equity ?? 0;
    const cur = equityCurve[i]?.equity ?? 0;
    if (prev > 0) dailyReturns.push(cur / prev - 1);
  }
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / Math.max(1, dailyReturns.length);
  const variance =
    dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, dailyReturns.length);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(365) : 0;
  const downside = Math.sqrt(
    dailyReturns
      .filter((r) => r < 0)
      .reduce((a, b) => a + b * b, 0) / Math.max(1, dailyReturns.length),
  );
  const sortino = downside > 0 ? (mean / downside) * Math.sqrt(365) : 0;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? 99 : 0;
  const avgWinPct =
    wins.length > 0 ? wins.reduce((a, b) => a + b.pnlPct, 0) / wins.length : 0;
  const avgLossPct =
    losses.length > 0 ? losses.reduce((a, b) => a + b.pnlPct, 0) / losses.length : 0;

  let verdict: BacktestMetrics["verdict"];
  if (finalEq <= req.initialCapital * 0.05) verdict = "blown";
  else if (annualReturnPct >= 200 && maxDD > -60 && sharpe > 1) verdict = "excellent";
  else if (annualReturnPct >= 50 && maxDD > -50) verdict = "good";
  else if (annualReturnPct >= 0) verdict = "mediocre";
  else verdict = "poor";

  return {
    strategyId: strategy.id,
    request: req,
    metrics: {
      totalReturnPct: round(totalReturnPct, 2),
      annualReturnPct: round(annualReturnPct, 2),
      maxDrawdownPct: round(maxDD, 2),
      sharpe: round(sharpe, 3),
      sortino: round(sortino, 3),
      winRate: round(winRate, 2),
      profitFactor: round(profitFactor, 3),
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      avgWinPct: round(avgWinPct, 3),
      avgLossPct: round(avgLossPct, 3),
      finalEquity: round(finalEq, 2),
      liquidations,
      verdict,
    },
    equityCurve,
    trades,
    candles,
  };
}
