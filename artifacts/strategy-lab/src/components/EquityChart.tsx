import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquityPoint } from "@workspace/api-client-react";
import { formatDate, formatDollar, formatPercent } from "@/lib/format";

type Series = {
  name: string;
  color: string;
  data: EquityPoint[];
};

type Props = {
  series: Series[];
  height?: number;
  variant?: "equity" | "drawdown";
};

export function EquityChart({ series, height = 260, variant = "equity" }: Props) {
  const merged = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    for (const s of series) {
      for (const point of s.data) {
        const row = map.get(point.t) ?? { t: point.t };
        row[s.name] = variant === "equity" ? point.equity : point.drawdown;
        map.set(point.t, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => String(a.t).localeCompare(String(b.t)));
  }, [series, variant]);

  if (merged.length === 0) return null;

  const isDD = variant === "drawdown";
  const Chart = isDD ? AreaChart : LineChart;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={merged} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.name} id={`grad-${s.name}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 24% 18%)" vertical={false} />
          <XAxis
            dataKey="t"
            stroke="hsl(215 16% 55%)"
            fontSize={10}
            tickFormatter={formatDate}
            minTickGap={32}
          />
          <YAxis
            stroke="hsl(215 16% 55%)"
            fontSize={10}
            width={56}
            tickFormatter={(v) =>
              isDD
                ? `${Number(v).toFixed(0)}%`
                : Math.abs(Number(v)) >= 10000
                  ? `${(Number(v) / 1000).toFixed(0)}k`
                  : Number(v).toFixed(0)
            }
          />
          <Tooltip
            contentStyle={{
              background: "hsl(222 32% 10%)",
              border: "1px solid hsl(222 24% 18%)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(l) => formatDate(String(l))}
            formatter={(v: number | string, name) => [
              isDD ? formatPercent(Number(v)) : formatDollar(Number(v)),
              name,
            ]}
          />
          {series.map((s) =>
            isDD ? (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={s.color}
                strokeWidth={1.5}
                fill={`url(#grad-${s.name})`}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}
