import { useMemo } from "react";
import type { EquityPoint } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type MonthlyReturn = {
  year: number;
  month: number; // 0-11
  returnPct: number;
  endEquity: number;
};

function computeMonthly(
  equityCurve: EquityPoint[],
  splitDate: string,
): MonthlyReturn[] {
  if (equityCurve.length === 0) return [];

  // Group: for each (year, month) keep the last equity point.
  type MonthBucket = { year: number; month: number; lastEquity: number; lastT: number };
  const buckets = new Map<string, MonthBucket>();
  for (const pt of equityCurve) {
    const d = new Date(pt.t);
    if (Number.isNaN(d.getTime())) continue;
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const key = `${y}-${m}`;
    const t = d.getTime();
    const existing = buckets.get(key);
    if (!existing || t > existing.lastT) {
      buckets.set(key, { year: y, month: m, lastEquity: pt.equity, lastT: t });
    }
  }

  // Sort chronologically
  const ordered = Array.from(buckets.values()).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );

  // Use the very first equity point as the seed for the first month's return.
  let prevEquity = equityCurve[0]!.equity;
  const result: MonthlyReturn[] = [];
  for (const b of ordered) {
    const ret = prevEquity === 0 ? 0 : (b.lastEquity / prevEquity - 1) * 100;
    result.push({
      year: b.year,
      month: b.month,
      returnPct: ret,
      endEquity: b.lastEquity,
    });
    prevEquity = b.lastEquity;
  }
  // splitDate intentionally available to caller for marking OOS cells
  void splitDate;
  return result;
}

// Static class names so Tailwind JIT can pick them up.
const POS_CLASSES = [
  "bg-emerald-500/10",
  "bg-emerald-500/20",
  "bg-emerald-500/30",
  "bg-emerald-500/40",
  "bg-emerald-500/50",
  "bg-emerald-500/60",
  "bg-emerald-500/70",
  "bg-emerald-500/80",
];
const NEG_CLASSES = [
  "bg-red-500/10",
  "bg-red-500/20",
  "bg-red-500/30",
  "bg-red-500/40",
  "bg-red-500/50",
  "bg-red-500/60",
  "bg-red-500/70",
  "bg-red-500/80",
];

function colorFor(r: number, maxAbs: number): string {
  if (!Number.isFinite(r) || r === 0) {
    return "bg-card/30";
  }
  const intensity = Math.min(1, Math.abs(r) / Math.max(1e-6, maxAbs));
  const idx = Math.min(POS_CLASSES.length - 1, Math.floor(intensity * POS_CLASSES.length));
  return r > 0 ? POS_CLASSES[idx]! : NEG_CLASSES[idx]!;
}

function textColorFor(r: number): string {
  if (!Number.isFinite(r) || r === 0) return "text-muted-foreground/70";
  return r > 0 ? "text-emerald-100" : "text-red-100";
}

export function MonthlyReturnsHeatmap({
  equityCurve,
  splitDate,
}: {
  equityCurve: EquityPoint[];
  splitDate: string;
}) {
  const monthly = useMemo(
    () => computeMonthly(equityCurve, splitDate),
    [equityCurve, splitDate],
  );

  const split = useMemo(() => {
    const d = new Date(splitDate);
    return Number.isNaN(d.getTime())
      ? null
      : { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  }, [splitDate]);

  const { years, byKey, maxAbs, yearTotals } = useMemo(() => {
    const yearSet = new Set<number>();
    const map = new Map<string, MonthlyReturn>();
    let mx = 0;
    for (const r of monthly) {
      yearSet.add(r.year);
      map.set(`${r.year}-${r.month}`, r);
      if (Math.abs(r.returnPct) > mx) mx = Math.abs(r.returnPct);
    }
    const ys = Array.from(yearSet).sort((a, b) => a - b);

    // Year totals: compound monthly returns for the year using only months we have
    const totals = new Map<number, { ret: number; count: number }>();
    for (const y of ys) {
      let factor = 1;
      let count = 0;
      for (let m = 0; m < 12; m += 1) {
        const cell = map.get(`${y}-${m}`);
        if (cell) {
          factor *= 1 + cell.returnPct / 100;
          count += 1;
        }
      }
      totals.set(y, { ret: (factor - 1) * 100, count });
    }
    return { years: ys, byKey: map, maxAbs: mx, yearTotals: totals };
  }, [monthly]);

  if (monthly.length === 0) {
    return null;
  }

  const isOOS = (y: number, m: number) => {
    if (!split) return false;
    return y > split.year || (y === split.year && m >= split.month);
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-3 flex-wrap">
          <span>Monthly Returns Heatmap</span>
          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70" />
              gain
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-red-500/70" />
              loss
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm border border-primary/60 bg-primary/10" />
              OOS
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 sm:px-4 pb-4 pt-0">
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-[10px] sm:text-[11px] font-mono border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left pr-2 text-muted-foreground/60 uppercase tracking-wider font-normal text-[9px] w-12">
                  Year
                </th>
                {MONTHS.map((m) => (
                  <th
                    key={m}
                    className="text-center text-muted-foreground/60 uppercase tracking-wider font-normal text-[9px] py-1"
                  >
                    {m}
                  </th>
                ))}
                <th className="text-center text-muted-foreground/60 uppercase tracking-wider font-normal text-[9px] pl-2 w-16">
                  Year
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const total = yearTotals.get(y);
                return (
                  <tr key={y}>
                    <td className="pr-2 text-muted-foreground font-semibold align-middle">
                      {y}
                    </td>
                    {Array.from({ length: 12 }, (_, m) => {
                      const cell = byKey.get(`${y}-${m}`);
                      const oos = isOOS(y, m);
                      if (!cell) {
                        return (
                          <td key={m} className="p-0">
                            <div
                              className={cn(
                                "h-7 sm:h-8 rounded-sm flex items-center justify-center text-muted-foreground/30",
                                "bg-card/10 border border-dashed border-border/30",
                              )}
                            >
                              ·
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={m} className="p-0">
                          <div
                            title={`${MONTHS[m]} ${y}: ${formatPercent(cell.returnPct, 2)} (equity $${cell.endEquity.toFixed(0)})${oos ? " · OOS" : ""}`}
                            className={cn(
                              "h-7 sm:h-8 rounded-sm flex items-center justify-center px-1 text-[9px] sm:text-[10px] font-semibold tabular-nums",
                              colorFor(cell.returnPct, maxAbs),
                              textColorFor(cell.returnPct),
                              oos && "ring-1 ring-primary/60 ring-inset",
                            )}
                          >
                            {cell.returnPct > 999
                              ? "999%+"
                              : cell.returnPct < -99
                                ? "-99%"
                                : `${cell.returnPct >= 0 ? "+" : ""}${cell.returnPct.toFixed(cell.returnPct >= 100 || cell.returnPct <= -100 ? 0 : 1)}`}
                          </div>
                        </td>
                      );
                    })}
                    <td className="pl-2 align-middle">
                      <div
                        className={cn(
                          "h-7 sm:h-8 rounded-sm flex items-center justify-center px-1 text-[10px] font-bold tabular-nums",
                          total && total.ret !== 0
                            ? total.ret > 0
                              ? "bg-emerald-500/30 text-emerald-100"
                              : "bg-red-500/30 text-red-100"
                            : "bg-card/30 text-muted-foreground/70",
                        )}
                      >
                        {total ? formatPercent(total.ret, 1) : "—"}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground/70 font-mono">
          Cells show monthly equity-curve returns. The right column compounds the
          months we have for each year (partial years are still partial).
        </div>
      </CardContent>
    </Card>
  );
}
