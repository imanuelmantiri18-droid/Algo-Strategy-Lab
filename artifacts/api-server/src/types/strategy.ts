export type Candle = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type StrategyParam = {
  key: string;
  label: string;
  type: "number";
  default: number;
  min: number;
  max: number;
  step: number;
  description?: string;
};

export type StrategyMeta = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: "trend" | "mean_reversion" | "breakout" | "momentum" | "moonshot";
  risk: "low" | "medium" | "high" | "extreme";
  params: StrategyParam[];
};

export type Signal = -1 | 0 | 1;

export type StrategyDef = StrategyMeta & {
  generateSignals: (candles: Candle[], params: Record<string, number>) => Signal[];
};
