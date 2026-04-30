import type { BacktestResult, Trade } from "@workspace/api-client-react";

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick to give the browser time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const TRADE_COLUMNS: Array<{ key: keyof Trade; label: string }> = [
  { key: "side", label: "side" },
  { key: "sample", label: "sample" },
  { key: "entryTime", label: "entry_time" },
  { key: "entryPrice", label: "entry_price" },
  { key: "exitTime", label: "exit_time" },
  { key: "exitPrice", label: "exit_price" },
  { key: "stopPrice", label: "stop_price" },
  { key: "takeProfitPrice", label: "take_profit_price" },
  { key: "pnl", label: "pnl_usd" },
  { key: "pnlPct", label: "pnl_pct" },
  { key: "feePaid", label: "fee_paid" },
  { key: "fundingPaid", label: "funding_paid" },
  { key: "exitReason", label: "exit_reason" },
];

export function tradesToCsv(trades: Trade[]): string {
  const header = TRADE_COLUMNS.map((c) => c.label).join(",");
  const rows = trades.map((t) =>
    TRADE_COLUMNS.map((c) => {
      const v = t[c.key];
      if (c.key === "entryTime" || c.key === "exitTime") {
        return new Date(v as number).toISOString();
      }
      return csvEscape(v);
    }).join(","),
  );
  return [header, ...rows].join("\n");
}

export function exportBacktestJson(result: BacktestResult): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    strategyId: result.strategyId,
    request: result.request,
    metrics: result.metrics,
    walkForward: result.walkForward,
    trades: result.trades,
    equityCurve: result.equityCurve,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadBlob(`${result.strategyId}-${stamp}.json`, blob);
}

export function exportTradesCsv(result: BacktestResult): void {
  const csv = tradesToCsv(result.trades);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadBlob(`${result.strategyId}-trades-${stamp}.csv`, blob);
}
