import { useEffect, useState } from "react";

type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };

// SVG viewport dimensions
const VW = 800;
const VH = 300;
const PAD = { top: 14, right: 52, bottom: 22, left: 4 };
const VOL_H = 36;
const CHART_H = VH - PAD.top - PAD.bottom - VOL_H - 8;

function fmtPrice(p: number): string {
  return p >= 10_000 ? `${(p / 1_000).toFixed(1)}k` : p.toFixed(1);
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:00`;
}

export function CandleChart({
  markPrice,
  sl,
  tp,
}: {
  markPrice?: number;
  sl?: number | null;
  tp?: number | null;
}) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    fetch("/api/bot/candles?limit=80")
      .then((r) => r.json())
      .then((d: { candles: Candle[] }) => {
        setCandles(d.candles ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading || candles.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card flex items-center justify-center h-[200px] text-muted-foreground font-mono text-xs">
        {loading ? "Memuat chart…" : "Tidak ada data candle"}
      </div>
    );
  }

  // Layout
  const x0 = PAD.left;
  const x1 = VW - PAD.right;
  const y0 = PAD.top;
  const y1 = PAD.top + CHART_H;
  const vy0 = y1 + 8;
  const vy1 = VH - PAD.bottom;
  const chartW = x1 - x0;

  const n = candles.length;
  const slotW = chartW / n;
  const bodyW = Math.max(1.5, slotW * 0.6);

  // Price range
  const extras = [markPrice, sl, tp].filter((x): x is number => !!x && x > 0);
  const pMax = Math.max(...candles.map((c) => c.h), ...extras);
  const pMin = Math.min(...candles.map((c) => c.l), ...extras);
  const pPad = (pMax - pMin) * 0.06 || 100;
  const pH = pMax + pPad;
  const pL = pMin - pPad;
  const pR = pH - pL;

  const py = (p: number) => y0 + ((pH - p) / pR) * CHART_H;
  const cx = (i: number) => x0 + (i + 0.5) * slotW;

  // Volume
  const maxV = Math.max(...candles.map((c) => c.v));
  const vy = (v: number) => vy1 - (v / maxV) * (vy1 - vy0) * 0.9;

  // Grid ticks (6 horizontal)
  const gridTicks = Array.from({ length: 6 }, (_, i) => pL + (pR * i) / 5);

  // Time labels step
  const tStep = Math.max(1, Math.floor(n / 5));

  const lastCandle = candles[n - 1]!;
  const lastClose = lastCandle.c;
  const prevClose = candles[n - 2]?.c ?? lastClose;
  const dayChange = ((lastClose - prevClose) / prevClose) * 100;
  const changeColor = dayChange >= 0 ? "#34d399" : "#f87171";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3 flex-wrap">
        <span className="text-xs font-mono font-bold text-foreground uppercase tracking-widest">
          BTC/USDT · 1H
        </span>
        {markPrice && (
          <span className="text-sm font-mono font-semibold text-foreground">
            ${markPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        <span className="text-xs font-mono" style={{ color: changeColor }}>
          {dayChange >= 0 ? "+" : ""}{dayChange.toFixed(2)}%
        </span>
        {sl && tp && (
          <span className="text-[10px] font-mono text-muted-foreground">
            SL <span className="text-red-400">${sl.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            {" · "}
            TP <span className="text-emerald-400">${tp.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">{n} candles · refresh 30s</span>
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="w-full block"
        style={{ height: 260 }}
        preserveAspectRatio="none"
      >
        {/* Grid lines */}
        {gridTicks.map((p, i) => (
          <line key={i} x1={x0} y1={py(p)} x2={x1} y2={py(p)}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        ))}

        {/* Volume separator */}
        <line x1={x0} y1={vy0 - 1} x2={x1} y2={vy0 - 1}
          stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

        {/* SL line */}
        {sl && sl > pL && sl < pH && (
          <g>
            <line x1={x0} y1={py(sl)} x2={x1} y2={py(sl)}
              stroke="#f87171" strokeWidth="1" strokeDasharray="5,3" opacity="0.85" />
            <rect x={x1 + 1} y={py(sl) - 7} width={PAD.right - 3} height={13} fill="#450a0a" rx="2" />
            <text x={x1 + 4} y={py(sl) + 4} fill="#f87171" fontSize="9" fontFamily="monospace">SL</text>
          </g>
        )}

        {/* TP line */}
        {tp && tp > pL && tp < pH && (
          <g>
            <line x1={x0} y1={py(tp)} x2={x1} y2={py(tp)}
              stroke="#34d399" strokeWidth="1" strokeDasharray="5,3" opacity="0.85" />
            <rect x={x1 + 1} y={py(tp) - 7} width={PAD.right - 3} height={13} fill="#064e3b" rx="2" />
            <text x={x1 + 4} y={py(tp) + 4} fill="#34d399" fontSize="9" fontFamily="monospace">TP</text>
          </g>
        )}

        {/* Mark price line */}
        {markPrice && markPrice > pL && markPrice < pH && (
          <g>
            <line x1={x0} y1={py(markPrice)} x2={x1} y2={py(markPrice)}
              stroke="#60a5fa" strokeWidth="1" strokeDasharray="2,2" opacity="0.9" />
            <rect x={x1 + 1} y={py(markPrice) - 7} width={PAD.right - 3} height={13} fill="#1e3a5f" rx="2" />
            <text x={x1 + 4} y={py(markPrice) + 4} fill="#93c5fd" fontSize="9" fontFamily="monospace">
              {fmtPrice(markPrice)}
            </text>
          </g>
        )}

        {/* Candles */}
        {candles.map((c, i) => {
          const bull = c.c >= c.o;
          const strokeCol = bull ? "#34d399" : "#f87171";
          const fillCol = bull ? "#065f46" : "#450a0a";
          const x = cx(i);
          const bTop = py(Math.max(c.o, c.c));
          const bBot = py(Math.min(c.o, c.c));
          const bH = Math.max(1, bBot - bTop);
          return (
            <g key={i}>
              <line x1={x} y1={py(c.h)} x2={x} y2={py(c.l)}
                stroke={strokeCol} strokeWidth="1" opacity="0.75" />
              <rect x={x - bodyW / 2} y={bTop} width={bodyW} height={bH}
                fill={fillCol} stroke={strokeCol} strokeWidth="0.8" />
            </g>
          );
        })}

        {/* Volume bars */}
        {candles.map((c, i) => {
          const bull = c.c >= c.o;
          const x = cx(i);
          const top = vy(c.v);
          return (
            <rect key={i}
              x={x - bodyW / 2} y={top} width={bodyW} height={vy1 - top}
              fill={bull ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}
            />
          );
        })}

        {/* Price labels (right axis) */}
        {gridTicks.map((p, i) => (
          <text key={i} x={x1 + 3} y={py(p) + 3}
            fill="rgba(156,163,175,0.55)" fontSize="9" fontFamily="monospace">
            {fmtPrice(p)}
          </text>
        ))}

        {/* Time labels (bottom axis) */}
        {candles.map((c, i) => {
          if (i % tStep !== 0) return null;
          return (
            <text key={i} x={cx(i)} y={VH - 5}
              fill="rgba(156,163,175,0.5)" fontSize="8" fontFamily="monospace" textAnchor="middle">
              {fmtTime(c.t)}
            </text>
          );
        })}

        {/* Outer border */}
        <rect x={x0} y={y0} width={chartW} height={vy1 - y0}
          fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      </svg>
    </div>
  );
}
