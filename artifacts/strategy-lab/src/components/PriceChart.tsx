import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Candle, Trade } from "@workspace/api-client-react";
import { formatDate, formatDollar } from "@/lib/format";

type Props = {
  candles: Candle[];
  trades: Trade[];
  height?: number;
};

export function PriceChart({ candles, trades, height = 280 }: Props) {
  if (!candles.length) return null;
  const data = candles.map((c) => ({ t: c.t, c: c.c }));
  const maxMarkers = 60;
  const stride = Math.max(1, Math.ceil(trades.length / maxMarkers));
  const sampledTrades = trades.filter((_t, i) => i % stride === 0);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 24% 18%)" vertical={false} />
          <XAxis
            dataKey="t"
            stroke="hsl(215 16% 55%)"
            fontSize={10}
            tickFormatter={formatDate}
            minTickGap={36}
          />
          <YAxis
            stroke="hsl(215 16% 55%)"
            fontSize={10}
            width={56}
            tickFormatter={(v) =>
              Math.abs(Number(v)) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : `${v}`
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
            formatter={(v: number | string) => [formatDollar(Number(v)), "BTC"]}
          />
          <Line
            type="monotone"
            dataKey="c"
            stroke="hsl(198 90% 56%)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          {sampledTrades.map((t, i) => {
            const isWin = t.pnl > 0;
            const color =
              t.exitReason === "liquidation"
                ? "hsl(0 78% 58%)"
                : isWin
                  ? "hsl(152 90% 48%)"
                  : "hsl(38 95% 58%)";
            return (
              <ReferenceDot
                key={i}
                x={t.entryTime}
                y={t.entryPrice}
                r={3}
                fill={color}
                stroke="none"
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
