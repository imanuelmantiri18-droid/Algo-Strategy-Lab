import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

export type RiskValues = {
  leverage: number;
  stopLossPct: number;
  takeProfitPct: number;
  days: number;
  initialCapital: number;
};

type Props = {
  values: RiskValues;
  onChange: (next: RiskValues) => void;
};

function Row({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
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
            className="h-7 w-24 text-right font-mono text-xs px-2"
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
    </div>
  );
}

export function RiskControls({ values, onChange }: Props) {
  const set = (patch: Partial<RiskValues>) => onChange({ ...values, ...patch });
  return (
    <div className="space-y-3">
      <Row
        label="Leverage"
        value={values.leverage}
        min={1}
        max={50}
        step={1}
        suffix="x"
        onChange={(n) => set({ leverage: n })}
      />
      <Row
        label="Stop Loss"
        value={values.stopLossPct}
        min={0.5}
        max={50}
        step={0.5}
        suffix="%"
        onChange={(n) => set({ stopLossPct: n })}
      />
      <Row
        label="Take Profit"
        value={values.takeProfitPct}
        min={0.5}
        max={200}
        step={0.5}
        suffix="%"
        onChange={(n) => set({ takeProfitPct: n })}
      />
      <Row
        label="Backtest Days"
        value={values.days}
        min={60}
        max={1825}
        step={30}
        onChange={(n) => set({ days: n })}
      />
      <Row
        label="Initial Capital"
        value={values.initialCapital}
        min={100}
        max={1_000_000}
        step={100}
        suffix="$"
        onChange={(n) => set({ initialCapital: n })}
      />
    </div>
  );
}
