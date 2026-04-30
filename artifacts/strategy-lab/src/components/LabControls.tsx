import type { IntervalValue } from "@/lib/format";

export type RiskValues = {
  leverage: number;
  atrPeriod: number;
  atrMultiplierSL: number;
  riskRewardRatio: number;
  makerFeePct: number;
  takerFeePct: number;
  slippagePct: number;
  riskPerTradePct: number;
  fundingRatePct8h: number;
  maxHoldingBars: number;
};

export type LabConfig = {
  interval: IntervalValue;
  lookbackDays: number;
  initialCapital: number;
  walkForwardSplit: number;
  walkForwardSplitDate?: string;
  useDateSplit: boolean;
  risk: RiskValues;
};

export const DEFAULT_RISK: RiskValues = {
  leverage: 10,
  atrPeriod: 14,
  atrMultiplierSL: 1.5,
  riskRewardRatio: 2,
  makerFeePct: 0.01,
  takerFeePct: 0.035,
  slippagePct: 0.02,
  riskPerTradePct: 5,
  fundingRatePct8h: 0.01,
  maxHoldingBars: 96,
};

export const DEFAULT_CONFIG: LabConfig = {
  interval: "1h",
  lookbackDays: 1580,
  initialCapital: 10000,
  walkForwardSplit: 0.7,
  walkForwardSplitDate: "2025-01-01",
  useDateSplit: true,
  risk: DEFAULT_RISK,
};

export const FIXED_CONFIG_SUMMARY = {
  intervalLabel: "1H candles",
  periodLabel: "Jan 2022 → today (~1580 days)",
  splitLabel: "Train < 2025-01-01 · Test ≥ 2025-01-01",
  riskLabel: "10× leverage · 5% risk/trade · R:R 1:2",
  feeLabel: "Maker 0.01% · Taker 0.035% · Slip 0.02%",
  capitalLabel: "$10,000 starting capital",
  ddFilterPct: 40,
};

function intervalToLabel(v: string): string {
  if (v === "1d") return "1D candles";
  if (v.endsWith("h")) return `${v.replace("h", "").toUpperCase()}H candles`;
  return `${v} candles`;
}

/**
 * Derive the human-readable summary labels for the *current* user-edited
 * config. Only the editable fields (interval, leverage, riskPerTradePct)
 * change relative to FIXED_CONFIG_SUMMARY — the others stay locked.
 */
export function deriveConfigSummary(c: LabConfig) {
  return {
    ...FIXED_CONFIG_SUMMARY,
    intervalLabel: intervalToLabel(c.interval),
    riskLabel: `${c.risk.leverage}× leverage · ${c.risk.riskPerTradePct}% risk/trade · R:R 1:${c.risk.riskRewardRatio}`,
  };
}
