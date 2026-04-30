export type Interval = "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "1d";

export type Candle = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
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

export const INTERVAL_MS: Record<Interval, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export const INTERVAL_PER_YEAR: Record<Interval, number> = {
  "5m": (365 * 24 * 60) / 5,
  "15m": (365 * 24 * 60) / 15,
  "30m": (365 * 24 * 60) / 30,
  "1h": 365 * 24,
  "2h": (365 * 24) / 2,
  "4h": (365 * 24) / 4,
  "1d": 365,
};

// Hard caps on candle count per interval to prevent server crashes & API abuse.
export const MAX_CANDLES_PER_INTERVAL: Record<Interval, number> = {
  "5m": 26_000, // ~90 days
  "15m": 18_000, // ~187 days
  "30m": 18_000, // ~375 days
  "1h": 9_000, // ~375 days
  "2h": 9_000, // ~750 days
  "4h": 5_000, // ~833 days
  "1d": 1_825, // 5 years
};
