import { useEffect, useState } from "react";
import type { LabConfig } from "@/components/LabControls";
import type { IntervalValue } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const INTERVAL_OPTIONS: Array<{ value: IntervalValue; label: string }> = [
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1H" },
  { value: "2h", label: "2H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

const LEVERAGE_PRESETS = [3, 5, 10, 20];
const RISK_PRESETS = [1, 2, 5, 10];
const CAPITAL_PRESETS = [10, 100, 1000, 10000];

function formatCapitalShort(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `$${n}`;
}

type Props = {
  config: LabConfig;
  onChange: (next: LabConfig) => void;
  onReset: () => void;
  isDefault: boolean;
};

export function ConfigBar({ config, onChange, onReset, isDefault }: Props) {
  const setInterval = (v: IntervalValue) => onChange({ ...config, interval: v });
  const setLeverage = (n: number) =>
    onChange({ ...config, risk: { ...config.risk, leverage: n } });
  const setRiskPct = (n: number) =>
    onChange({ ...config, risk: { ...config.risk, riskPerTradePct: n } });
  const setCapital = (n: number) => onChange({ ...config, initialCapital: n });

  // Real-trading sanity hint: Binance USDT-M perpetuals require min ~$5 notional.
  // notional = initialCapital * (riskPerTradePct/100) * leverage
  const notional =
    config.initialCapital * (config.risk.riskPerTradePct / 100) * config.risk.leverage;
  const showMinNotionalWarning = notional < 5;

  return (
    <Card className="px-3 sm:px-4 py-3 mb-4 bg-card/40">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-5">
        <ControlGroup label="Timeframe">
          <div className="flex border border-border/60 rounded overflow-hidden">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setInterval(opt.value)}
                className={cn(
                  "h-8 px-2.5 text-[11px] font-mono uppercase tracking-wider transition border-r border-border/40 last:border-r-0",
                  config.interval === opt.value
                    ? "bg-primary/20 text-primary font-bold"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/60",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup label="Leverage">
          <div className="flex items-center gap-2">
            <div className="flex border border-border/60 rounded overflow-hidden">
              {LEVERAGE_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLeverage(n)}
                  className={cn(
                    "h-8 px-2.5 text-[11px] font-mono uppercase tracking-wider transition border-r border-border/40 last:border-r-0 min-w-[40px]",
                    config.risk.leverage === n
                      ? "bg-primary/20 text-primary font-bold"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/60",
                  )}
                >
                  {n}×
                </button>
              ))}
            </div>
            <NumberInput
              value={config.risk.leverage}
              min={1}
              max={125}
              step={1}
              suffix="×"
              onChange={setLeverage}
            />
          </div>
        </ControlGroup>

        <ControlGroup label="Risk / Trade">
          <div className="flex items-center gap-2">
            <div className="flex border border-border/60 rounded overflow-hidden">
              {RISK_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRiskPct(n)}
                  className={cn(
                    "h-8 px-2.5 text-[11px] font-mono uppercase tracking-wider transition border-r border-border/40 last:border-r-0 min-w-[40px]",
                    config.risk.riskPerTradePct === n
                      ? "bg-primary/20 text-primary font-bold"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/60",
                  )}
                >
                  {n}%
                </button>
              ))}
            </div>
            <NumberInput
              value={config.risk.riskPerTradePct}
              min={0.5}
              max={50}
              step={0.5}
              suffix="%"
              onChange={setRiskPct}
            />
          </div>
        </ControlGroup>

        <ControlGroup label="Starting Capital">
          <div className="flex items-center gap-2">
            <div className="flex border border-border/60 rounded overflow-hidden">
              {CAPITAL_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCapital(n)}
                  className={cn(
                    "h-8 px-2.5 text-[11px] font-mono uppercase tracking-wider transition border-r border-border/40 last:border-r-0 min-w-[44px]",
                    config.initialCapital === n
                      ? "bg-primary/20 text-primary font-bold"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/60",
                  )}
                >
                  {formatCapitalShort(n)}
                </button>
              ))}
            </div>
            <NumberInput
              value={config.initialCapital}
              min={10}
              max={1_000_000}
              step={10}
              prefix="$"
              wide
              onChange={setCapital}
            />
          </div>
        </ControlGroup>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onReset}
          disabled={isDefault}
          className={cn(
            "h-8 px-3 text-[10px] font-mono uppercase tracking-wider rounded border transition",
            isDefault
              ? "border-border/30 text-muted-foreground/40 cursor-not-allowed"
              : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-card/60",
          )}
          title="Reset to default config (1H · 10× · 5%)"
        >
          ↺ Reset
        </button>
      </div>

      <div className="mt-2 text-[10px] font-mono text-muted-foreground/70">
        Changes apply on next <span className="text-primary">Run</span> /{" "}
        <span className="text-primary">Run Tournament</span>. R:R, ATR stops, fees,
        and walk-forward split stay locked at proven values.
      </div>

      {showMinNotionalWarning ? (
        <div className="mt-2 text-[10px] font-mono text-amber-300/90 leading-snug">
          ⚠ Per-trade notional ≈ ${notional.toFixed(2)} is below Binance's ~$5
          minimum. Backtest still runs, but those trades wouldn't fill in real
          life. Increase capital, leverage, or risk%.
        </div>
      ) : null}
    </Card>
  );
}

function ControlGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  suffix,
  prefix,
  wide,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  prefix?: string;
  wide?: boolean;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));

  // Re-sync local text when external value changes (e.g. preset click)
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number.parseFloat(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="flex items-center border border-border/60 rounded overflow-hidden h-8">
      {prefix ? (
        <span className="px-1.5 text-[10px] text-muted-foreground/70 font-mono border-r border-border/40 h-full flex items-center bg-card/30">
          {prefix}
        </span>
      ) : null}
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "bg-transparent px-2 text-[11px] font-mono text-foreground focus:outline-none focus:bg-card/60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
          wide ? "w-20" : "w-14",
        )}
      />
      {suffix ? (
        <span className="px-1.5 text-[10px] text-muted-foreground/70 font-mono border-l border-border/40 h-full flex items-center bg-card/30">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
