export function formatPercent(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function formatDollar(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

export function formatDollarSigned(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${formatDollar(Math.abs(n), digits)}`;
}

export function formatDate(t: string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "2-digit" });
}

export function formatDateTime(t: string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export type Verdict = "excellent" | "good" | "mediocre" | "poor" | "blown";
export function getVerdictColor(v: Verdict): string {
  switch (v) {
    case "excellent":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    case "good":
      return "bg-cyan-500/15 text-cyan-300 border-cyan-500/40";
    case "mediocre":
      return "bg-amber-500/15 text-amber-300 border-amber-500/40";
    case "poor":
      return "bg-orange-500/15 text-orange-300 border-orange-500/40";
    case "blown":
      return "bg-red-500/15 text-red-300 border-red-500/40";
  }
}

export const INTERVAL_OPTIONS = [
  { value: "5m", label: "5 minutes", perDay: 288 },
  { value: "15m", label: "15 minutes", perDay: 96 },
  { value: "30m", label: "30 minutes", perDay: 48 },
  { value: "1h", label: "1 hour", perDay: 24 },
  { value: "2h", label: "2 hours", perDay: 12 },
  { value: "4h", label: "4 hours", perDay: 6 },
  { value: "1d", label: "1 day", perDay: 1 },
] as const;

export type IntervalValue = (typeof INTERVAL_OPTIONS)[number]["value"];
