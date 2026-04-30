// Aggregating registry of all strategies.
// Backward-compat exports (ema, rsi, atr, closesArr, highsArr, lowsArr) are
// re-exported here so existing imports keep working.
import type { Candle, StrategyDef } from "../types/strategy";
import { ema, rsi, atr } from "./indicators";
import { SMC_STRATEGIES } from "./strategies/smc";
import { TREND_STRATEGIES } from "./strategies/trend";
import { MEANREV_STRATEGIES } from "./strategies/meanrev";
import { BREAKOUT_STRATEGIES } from "./strategies/breakout";
import { ORDERFLOW_STRATEGIES } from "./strategies/orderflow";
import { ADVANCED_STRATEGIES } from "./strategies/advanced";

function closes(candles: Candle[]): Float64Array {
  const out = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = candles[i]!.c;
  return out;
}
function highs(candles: Candle[]): Float64Array {
  const out = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = candles[i]!.h;
  return out;
}
function lows(candles: Candle[]): Float64Array {
  const out = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = candles[i]!.l;
  return out;
}

export const STRATEGIES: StrategyDef[] = [
  ...SMC_STRATEGIES,
  ...TREND_STRATEGIES,
  ...MEANREV_STRATEGIES,
  ...BREAKOUT_STRATEGIES,
  ...ORDERFLOW_STRATEGIES,
  ...ADVANCED_STRATEGIES,
];

export function getStrategy(id: string): StrategyDef | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function strategyMetaList() {
  return STRATEGIES.map(({ generateSignals: _g, ...meta }) => meta);
}

export function availableStrategies(): StrategyDef[] {
  return STRATEGIES.filter((s) => s.available !== false);
}

// Backward-compat shims for code that imports primitives from strategies.ts.
export { closes as closesArr, highs as highsArr, lows as lowsArr };
export { ema, rsi, atr };
