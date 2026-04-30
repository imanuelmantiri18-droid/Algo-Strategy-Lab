import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { INTERVAL_OPTIONS, type IntervalValue } from "@/lib/format";

export type RiskValues = {
  leverage: number;
  atrPeriod: number;
  atrMultiplierSL: number;
  riskRewardRatio: number;
  makerFeePct: number;
  takerFeePct: number;
  slippagePct: number;
};

export type LabConfig = {
  interval: IntervalValue;
  lookbackDays: number;
  initialCapital: number;
  walkForwardSplit: number;
  risk: RiskValues;
};

export const DEFAULT_RISK: RiskValues = {
  leverage: 10,
  atrPeriod: 14,
  atrMultiplierSL: 1.5,
  riskRewardRatio: 2,
  makerFeePct: 0.01,
  takerFeePct: 0.035,
  slippagePct: 0.05,
};

export const DEFAULT_CONFIG: LabConfig = {
  interval: "1h",
  lookbackDays: 365,
  initialCapital: 1000,
  walkForwardSplit: 0.7,
  risk: DEFAULT_RISK,
};

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  hint?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) onChange(n);
            }}
            className="h-7 w-20 text-right font-mono text-xs px-2"
          />
          {suffix ? (
            <span className="text-xs text-muted-foreground font-mono w-4">{suffix}</span>
          ) : null}
        </div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? value)}
      />
      {hint ? (
        <div className="text-[10px] text-muted-foreground/70 font-mono">{hint}</div>
      ) : null}
    </div>
  );
}

export function LabControls({
  config,
  onChange,
}: {
  config: LabConfig;
  onChange: (next: LabConfig) => void;
}) {
  const setRisk = (patch: Partial<RiskValues>) =>
    onChange({ ...config, risk: { ...config.risk, ...patch } });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Timeframe
        </label>
        <Select
          value={config.interval}
          onValueChange={(v) =>
            onChange({ ...config, interval: v as IntervalValue })
          }
        >
          <SelectTrigger className="h-9 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTERVAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="font-mono text-xs">
                {opt.value} · {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SliderRow
        label="Lookback (days)"
        value={config.lookbackDays}
        min={30}
        max={1825}
        step={15}
        onChange={(n) => onChange({ ...config, lookbackDays: n })}
        hint="Real BTC/USDT history fetched from Binance"
      />

      <SliderRow
        label="Initial Capital"
        value={config.initialCapital}
        min={100}
        max={100_000}
        step={100}
        suffix="$"
        onChange={(n) => onChange({ ...config, initialCapital: n })}
      />

      <Separator />

      <SliderRow
        label="Leverage"
        value={config.risk.leverage}
        min={1}
        max={50}
        step={1}
        suffix="x"
        hint="Recommended 10–20× for futures trading"
        onChange={(n) => setRisk({ leverage: n })}
      />

      <SliderRow
        label="ATR Period"
        value={config.risk.atrPeriod}
        min={5}
        max={50}
        step={1}
        onChange={(n) => setRisk({ atrPeriod: n })}
      />

      <SliderRow
        label="ATR × (Stop Loss)"
        value={config.risk.atrMultiplierSL}
        min={0.5}
        max={5}
        step={0.1}
        hint="Stop = entry ± ATR × this multiplier"
        onChange={(n) => setRisk({ atrMultiplierSL: n })}
      />

      <SliderRow
        label="Risk : Reward"
        value={config.risk.riskRewardRatio}
        min={1}
        max={5}
        step={0.25}
        hint="TP distance = SL distance × this ratio (min 1:2)"
        onChange={(n) => setRisk({ riskRewardRatio: n })}
      />

      <Separator />

      <div className="grid grid-cols-3 gap-2">
        <SliderRow
          label="Maker"
          value={config.risk.makerFeePct}
          min={0}
          max={0.1}
          step={0.005}
          suffix="%"
          onChange={(n) => setRisk({ makerFeePct: n })}
        />
        <SliderRow
          label="Taker"
          value={config.risk.takerFeePct}
          min={0}
          max={0.2}
          step={0.005}
          suffix="%"
          onChange={(n) => setRisk({ takerFeePct: n })}
        />
        <SliderRow
          label="Slippage"
          value={config.risk.slippagePct}
          min={0}
          max={0.5}
          step={0.005}
          suffix="%"
          onChange={(n) => setRisk({ slippagePct: n })}
        />
      </div>

      <Separator />

      <SliderRow
        label="Walk-forward Split"
        value={config.walkForwardSplit}
        min={0.5}
        max={0.9}
        step={0.05}
        hint={`${Math.round(config.walkForwardSplit * 100)}% in-sample / ${Math.round(
          (1 - config.walkForwardSplit) * 100,
        )}% out-of-sample`}
        onChange={(n) => onChange({ ...config, walkForwardSplit: n })}
      />
    </div>
  );
}
