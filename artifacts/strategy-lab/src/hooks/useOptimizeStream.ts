import { useCallback, useRef, useState } from "react";
import type {
  OptimizeRequest,
  OptimizeResult,
} from "@workspace/api-client-react";

export type OptimizeProgress = {
  done: number;
  total: number;
  kept: number;
  dropped: number;
  elapsedMs: number;
  etaMs: number;
  rate: number;
};

export type OptimizeStreamState = {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  status: string | null;
  progress: OptimizeProgress | null;
  data: OptimizeResult | null;
  start: (body: OptimizeRequest) => void;
  cancel: () => void;
  reset: () => void;
};

export function useOptimizeStream(): OptimizeStreamState {
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<OptimizeProgress | null>(null);
  const [data, setData] = useState<OptimizeResult | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setIsPending(false);
  }, []);

  const reset = useCallback(() => {
    setIsPending(false);
    setIsError(false);
    setError(null);
    setStatus(null);
    setProgress(null);
    setData(null);
  }, []);

  const start = useCallback((body: OptimizeRequest) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setIsPending(true);
    setIsError(false);
    setError(null);
    setStatus("connecting");
    setProgress(null);
    setData(null);

    (async () => {
      try {
        const res = await fetch("/api/backtest/optimize/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        // SSE parser: split on blank-line, each event has `event:` and `data:` fields
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = "message";
            const dataLines: string[] = [];
            for (const line of raw.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length === 0) continue;
            let payload: unknown;
            try {
              payload = JSON.parse(dataLines.join("\n"));
            } catch {
              continue;
            }
            handleEvent(event, payload);
          }
        }
        setIsPending(false);
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setIsPending(false);
          return;
        }
        setIsError(true);
        setError(e as Error);
        setIsPending(false);
      }
    })();

    function handleEvent(event: string, payload: unknown) {
      switch (event) {
        case "status": {
          const p = payload as { phase?: string; message?: string };
          setStatus(p.message ?? p.phase ?? null);
          break;
        }
        case "started": {
          const p = payload as { totalCombos: number };
          setProgress({
            done: 0,
            total: p.totalCombos,
            kept: 0,
            dropped: 0,
            elapsedMs: 0,
            etaMs: 0,
            rate: 0,
          });
          setStatus(`Sweeping ${p.totalCombos} combinations…`);
          break;
        }
        case "progress": {
          setProgress(payload as OptimizeProgress);
          break;
        }
        case "done": {
          setData(payload as OptimizeResult);
          setStatus("Completed");
          setIsPending(false);
          break;
        }
        case "error": {
          const p = payload as { message?: string };
          setIsError(true);
          setError(new Error(p.message ?? "Optimization failed"));
          setIsPending(false);
          break;
        }
      }
    }
  }, []);

  return { isPending, isError, error, status, progress, data, start, cancel, reset };
}
