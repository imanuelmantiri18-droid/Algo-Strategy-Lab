import type { StrategyParam } from "@workspace/api-client-react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

type Props = {
  params: StrategyParam[];
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
};

export function StrategyParams({ params, values, onChange }: Props) {
  if (!params.length) {
    return (
      <div className="text-xs text-muted-foreground italic">
        This strategy has no tunable parameters.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {params.map((p) => {
        const value = values[p.key] ?? p.default;
        return (
          <div key={p.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {p.label}
              </label>
              <Input
                type="number"
                value={value}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n)) onChange(p.key, n);
                }}
                className="h-7 w-20 text-right font-mono text-xs px-2"
              />
            </div>
            <Slider
              value={[value]}
              min={p.min}
              max={p.max}
              step={p.step}
              onValueChange={(v) => onChange(p.key, v[0] ?? value)}
            />
            {p.description ? (
              <div className="text-[10px] text-muted-foreground/80">{p.description}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
