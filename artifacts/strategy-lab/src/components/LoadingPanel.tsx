import { useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Props = {
  active: boolean;
  title: string;
  subtitle?: string;
  className?: string;
  steps?: string[];
  /** When provided, advances the visible step manually (0-based). */
  currentStep?: number;
};

export function LoadingPanel({
  active,
  title,
  subtitle,
  className,
  steps,
  currentStep,
}: Props) {
  const [progress, setProgress] = useState(0);
  const [autoStep, setAutoStep] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(0);
      setAutoStep(0);
      startedAt.current = null;
      return;
    }
    startedAt.current = Date.now();
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - (startedAt.current ?? Date.now())) / 1000;
      const next = Math.min(95, 10 + Math.atan(elapsed / 2) * 60);
      setProgress(next);
      if (steps && steps.length > 0 && currentStep == null) {
        setAutoStep(Math.min(steps.length - 1, Math.floor(elapsed * 0.9)));
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [active, steps, currentStep]);

  if (!active) return null;
  const stepIdx = currentStep != null ? Math.max(0, currentStep) : autoStep;
  const visible = steps?.slice(0, stepIdx + 1) ?? [];
  const totalSteps = steps?.length ?? 0;

  return (
    <div
      className={cn(
        "rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5 flex flex-col gap-3 glow-primary",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className="relative h-8 w-8 shrink-0">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{title}</div>
          {subtitle ? (
            <div className="text-[11px] text-muted-foreground font-mono truncate">
              {subtitle}
            </div>
          ) : null}
        </div>
        {totalSteps > 0 ? (
          <div className="text-[10px] font-mono text-muted-foreground shrink-0">
            {Math.min(stepIdx + 1, totalSteps)}/{totalSteps}
          </div>
        ) : null}
      </div>
      <Progress value={progress} className="h-1.5" />
      {visible.length > 0 ? (
        <div className="space-y-1 max-h-32 overflow-hidden">
          {visible.map((s, i) => {
            const isCurrent = i === stepIdx;
            return (
              <div
                key={i}
                className={cn(
                  "text-[11px] sm:text-xs font-mono leading-snug flex items-start gap-1.5",
                  isCurrent ? "text-primary" : "text-muted-foreground/70",
                )}
              >
                <span className="shrink-0">{isCurrent ? "›" : "✓"}</span>
                <span className="truncate">{s}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
