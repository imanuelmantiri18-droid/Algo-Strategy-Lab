import { useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Props = {
  active: boolean;
  title: string;
  subtitle?: string;
  className?: string;
  steps?: string[];
};

export function LoadingPanel({ active, title, subtitle, className, steps }: Props) {
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(0);
      setStepIdx(0);
      startedAt.current = null;
      return;
    }
    startedAt.current = Date.now();
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - (startedAt.current ?? Date.now())) / 1000;
      const next = Math.min(95, 12 + Math.atan(elapsed / 1.5) * 60);
      setProgress(next);
      if (steps && steps.length > 0) {
        setStepIdx(Math.min(steps.length - 1, Math.floor(elapsed * 1.6)));
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [active, steps]);

  if (!active) return null;
  const currentStep = steps?.[stepIdx];

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
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{title}</div>
          {subtitle ? (
            <div className="text-xs text-muted-foreground font-mono truncate">{subtitle}</div>
          ) : null}
        </div>
      </div>
      <Progress value={progress} className="h-1.5" />
      {currentStep ? (
        <div className="text-[11px] sm:text-xs text-muted-foreground font-mono">
          <span className="text-primary">›</span> {currentStep}
        </div>
      ) : null}
    </div>
  );
}
