import { useEffect, useState } from "react";

type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };

// SVG viewport
const VW = 800;
const VH = 310;
const PAD = { top: 20, right: 52, bottom: 22, left: 4 };
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

// ---------------------------------------------------------------------------
// WILLIAMS FRACTAL DETECTION — identical 5-bar rule used by the live bot
// Fractal HIGH: bar[i].h is strictly highest of 5 bars (i-2..i+2)
// Fractal LOW:  bar[i].l is strictly lowest  of 5 bars (i-2..i+2)
// Can only be confirmed at i = 2..n-3 (need 2 bars each side)
// ---------------------------------------------------------------------------
type Fractals = { highs: number[]; lows: number[] };

function detectFractals(candles: Candle[]): Fractals {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i]!.h;
    const l = candles[i]!.l;
    if (
      h > candles[i - 1]!.h && h > candles[i - 2]!.h &&
      h > candles[i + 1]!.h && h > candles[i + 2]!.h
    ) highs.push(i);
    if (
      l < candles[i - 1]!.l && l < candles[i - 2]!.l &&
      l < candles[i + 1]!.l && l < candles[i + 2]!.l
    ) lows.push(i);
  }
  return { highs, lows };
}

// SVG downward triangle (fractal high — bearish marker above wick)
function TriDown({ x, y, size, color, glow }: { x: number; y: number; size: number; color: string; glow?: boolean }) {
  const pts = `${x - size},${y - size} ${x + size},${y - size} ${x},${y}`;
  return (
    <g>
      {glow && <polygon points={pts} fill={color} opacity="0.25" transform={`scale(1.8) translate(${x * (1 - 1/1.8)},${y * (1 - 1/1.8)})`} />}
      <polygon points={pts} fill={color} opacity={glow ? 1 : 0.75} />
    </g>
  );
}

// SVG upward triangle (fractal low — bullish marker below wick)
function TriUp({ x, y, size, color, glow }: { x: number; y: number; size: number; color: string; glow?: boolean }) {
  const pts = `${x - size},${y + size} ${x + size},${y + size} ${x},${y}`;
  return (
    <g>
      {glow && <polygon points={pts} fill={color} opacity="0.25" transform={`scale(1.8) translate(${x * (1 - 1/1.8)},${y * (1 - 1/1.8)})`} />}
      <polygon points={pts} fill={color} opacity={glow ? 1 : 0.75} />
    </g>
  );
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
      .then((d: { candles: Candle[] }) => { setCandles(d.candles ?? []); setLoading(false); })
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
  const x0 = PAD.left, x1 = VW - PAD.right;
  const y0 = PAD.top, y1 = PAD.top + CHART_H;
  const vy0 = y1 + 8, vy1 = VH - PAD.bottom;
  const chartW = x1 - x0;
  const n = candles.length;
  const slotW = chartW / n;
  const bodyW = Math.max(1.5, slotW * 0.6);

  // Fractals
  const { highs: fractalHighIdx, lows: fractalLowIdx } = detectFractals(candles);
  const lastFractalHigh = fractalHighIdx.at(-1);
  const lastFractalLow = fractalLowIdx.at(-1);

  // Price range — include fractal levels + mark/sl/tp
  const extras = [markPrice, sl, tp].filter((x): x is number => !!x && x > 0);
  const pMax = Math.max(...candles.map((c) => c.h), ...extras);
  const pMin = Math.min(...candles.map((c) => c.l), ...extras);
  const pPad = (pMax - pMin) * 0.08 || 100;  // extra padding for triangles
  const pH = pMax + pPad, pL = pMin - pPad, pR = pH - pL;

  const py = (p: number) => y0 + ((pH - p) / pR) * CHART_H;
  const cx = (i: number) => x0 + (i + 0.5) * slotW;

  // Volume
  const maxV = Math.max(...candles.map((c) => c.v));
  const vy = (v: number) => vy1 - (v / maxV) * (vy1 - vy0) * 0.9;

  // Grid + time
  const gridTicks = Array.from({ length: 6 }, (_, i) => pL + (pR * i) / 5);
  const tStep = Math.max(1, Math.floor(n / 5));

  const lastCandle = candles[n - 1]!;
  const prevClose = candles[n - 2]?.c ?? lastCandle.c;
  const dayChange = ((lastCandle.c - prevClose) / prevClose) * 100;
  const changeColor = dayChange >= 0 ? "#34d399" : "#f87171";

  // Triangle sizing
  const triSz = Math.max(3, Math.min(5, slotW * 0.45));
  const triGap = triSz + 2;

  // Most recent fractal levels (horizontal breakout lines)
  const lastHighPrice = lastFractalHigh !== undefined ? candles[lastFractalHigh]!.h : null;
  const lastLowPrice = lastFractalLow !== undefined ? candles[lastFractalLow]!.l : null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3 flex-wrap">
        <span className="text-xs font-mono font-bold text-foreground uppercase tracking-widest">BTC/USDT · 1H</span>
        {markPrice && (
          <span className="text-sm font-mono font-semibold text-foreground">
            ${markPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        <span className="text-xs font-mono" style={{ color: changeColor }}>
          {dayChange >= 0 ? "+" : ""}{dayChange.toFixed(2)}%
        </span>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1">
            <svg width="8" height="8" viewBox="0 0 8 8"><polygon points="0,0 8,0 4,8" fill="#f59e0b" /></svg>
            <span className="text-amber-400">Fractal High</span>
          </span>
          <span className="flex items-center gap-1">
            <svg width="8" height="8" viewBox="0 0 8 8"><polygon points="0,8 8,8 4,0" fill="#a78bfa" /></svg>
            <span className="text-violet-400">Fractal Low</span>
          </span>
          {(lastHighPrice || lastLowPrice) && (
            <span className="text-muted-foreground">
              Level aktif:
              {lastHighPrice && <span className="text-amber-400 ml-1">H ${lastHighPrice.toFixed(0)}</span>}
              {lastLowPrice && <span className="text-violet-400 ml-1">L ${lastLowPrice.toFixed(0)}</span>}
            </span>
          )}
        </div>

        {sl && tp && (
          <span className="text-[10px] font-mono text-muted-foreground">
            SL <span className="text-red-400">${sl.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            {" · "}
            TP <span className="text-emerald-400">${tp.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">{n} candles · refresh 30s</span>
      </div>

      {/* SVG */}
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full block" style={{ height: 270 }} preserveAspectRatio="none">

        {/* Grid */}
        {gridTicks.map((p, i) => (
          <line key={i} x1={x0} y1={py(p)} x2={x1} y2={py(p)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        ))}

        {/* Volume separator */}
        <line x1={x0} y1={vy0 - 1} x2={x1} y2={vy0 - 1} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

        {/* Most recent fractal HIGH level (breakout target for LONG) */}
        {lastHighPrice && lastHighPrice > pL && lastHighPrice < pH && (
          <line x1={x0} y1={py(lastHighPrice)} x2={x1} y2={py(lastHighPrice)}
            stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="3,4" opacity="0.35" />
        )}

        {/* Most recent fractal LOW level (breakout target for SHORT) */}
        {lastLowPrice && lastLowPrice > pL && lastLowPrice < pH && (
          <line x1={x0} y1={py(lastLowPrice)} x2={x1} y2={py(lastLowPrice)}
            stroke="#a78bfa" strokeWidth="0.8" strokeDasharray="3,4" opacity="0.35" />
        )}

        {/* SL line */}
        {sl && sl > pL && sl < pH && (
          <g>
            <line x1={x0} y1={py(sl)} x2={x1} y2={py(sl)} stroke="#f87171" strokeWidth="1" strokeDasharray="5,3" opacity="0.85" />
            <rect x={x1 + 1} y={py(sl) - 7} width={PAD.right - 3} height={13} fill="#450a0a" rx="2" />
            <text x={x1 + 4} y={py(sl) + 4} fill="#f87171" fontSize="9" fontFamily="monospace">SL</text>
          </g>
        )}

        {/* TP line */}
        {tp && tp > pL && tp < pH && (
          <g>
            <line x1={x0} y1={py(tp)} x2={x1} y2={py(tp)} stroke="#34d399" strokeWidth="1" strokeDasharray="5,3" opacity="0.85" />
            <rect x={x1 + 1} y={py(tp) - 7} width={PAD.right - 3} height={13} fill="#064e3b" rx="2" />
            <text x={x1 + 4} y={py(tp) + 4} fill="#34d399" fontSize="9" fontFamily="monospace">TP</text>
          </g>
        )}

        {/* Mark price */}
        {markPrice && markPrice > pL && markPrice < pH && (
          <g>
            <line x1={x0} y1={py(markPrice)} x2={x1} y2={py(markPrice)} stroke="#60a5fa" strokeWidth="1" strokeDasharray="2,2" opacity="0.9" />
            <rect x={x1 + 1} y={py(markPrice) - 7} width={PAD.right - 3} height={13} fill="#1e3a5f" rx="2" />
            <text x={x1 + 4} y={py(markPrice) + 4} fill="#93c5fd" fontSize="9" fontFamily="monospace">{fmtPrice(markPrice)}</text>
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
          return (
            <g key={i}>
              <line x1={x} y1={py(c.h)} x2={x} y2={py(c.l)} stroke={strokeCol} strokeWidth="1" opacity="0.75" />
              <rect x={x - bodyW / 2} y={bTop} width={bodyW} height={Math.max(1, bBot - bTop)}
                fill={fillCol} stroke={strokeCol} strokeWidth="0.8" />
            </g>
          );
        })}

        {/* Williams Fractal HIGH markers (▼ amber, above wick) */}
        {fractalHighIdx.map((i) => {
          const isLast = i === lastFractalHigh;
          const x = cx(i);
          const y = py(candles[i]!.h) - triGap;
          return (
            <TriDown key={`fh-${i}`} x={x} y={y} size={triSz} color="#f59e0b" glow={isLast} />
          );
        })}

        {/* Williams Fractal LOW markers (▲ violet, below wick) */}
        {fractalLowIdx.map((i) => {
          const isLast = i === lastFractalLow;
          const x = cx(i);
          const y = py(candles[i]!.l) + triGap;
          return (
            <TriUp key={`fl-${i}`} x={x} y={y} size={triSz} color="#a78bfa" glow={isLast} />
          );
        })}

        {/* Volume bars */}
        {candles.map((c, i) => {
          const bull = c.c >= c.o;
          const x = cx(i);
          const top = vy(c.v);
          return (
            <rect key={i} x={x - bodyW / 2} y={top} width={bodyW} height={vy1 - top}
              fill={bull ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"} />
          );
        })}

        {/* Price labels */}
        {gridTicks.map((p, i) => (
          <text key={i} x={x1 + 3} y={py(p) + 3} fill="rgba(156,163,175,0.55)" fontSize="9" fontFamily="monospace">
            {fmtPrice(p)}
          </text>
        ))}

        {/* Time labels */}
        {candles.map((c, i) => {
          if (i % tStep !== 0) return null;
          return (
            <text key={i} x={cx(i)} y={VH - 5} fill="rgba(156,163,175,0.5)" fontSize="8" fontFamily="monospace" textAnchor="middle">
              {fmtTime(c.t)}
            </text>
          );
        })}

        {/* Border */}
        <rect x={x0} y={y0} width={chartW} height={vy1 - y0} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      </svg>
    </div>
  );
}
