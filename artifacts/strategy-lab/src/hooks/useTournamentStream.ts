import { useCallback, useRef, useState } from "react";
import type {
  TournamentRequest,
  TournamentResult,
  TournamentRow,
} from "@workspace/api-client-react";

export type TournamentProgress = {
  done: number;
  total: number;
  elapsedMs: number;
  etaMs: number;
  rate: number;
};

export type TournamentStreamState = {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  status: string | null;
  progress: TournamentProgress | null;
  /** Rows arriving live; cleared on each new run. */
  liveRows: TournamentRow[];
  /** Final, sorted/filtered tournament result — set on `done`. */
  data: TournamentResult | null;
  start: (body: TournamentRequest) => void;
  cancel: () => void;
  reset: () => void;
};

export function useTournamentStream(): TournamentStreamState {
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<TournamentProgress | null>(null);
  const [liveRows, setLiveRows] = useState<TournamentRow[]>([]);
  const [data, setData] = useState<TournamentResult | null>(null);
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
    setLiveRows([]);
    setData(null);
  }, []);

  const start = useCallback((body: TournamentRequest) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setIsPending(true);
    setIsError(false);
    setError(null);
    setStatus("connecting");
    setProgress(null);
    setLiveRows([]);
    setData(null);

    (async () => {
      try {
        const res = await fetch("/api/backtest/tournament/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
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
              else if (line.startsWith("data:"))
                dataLines.push(line.slice(5).trim());
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
          const p = payload as { totalStrategies: number };
          setProgress({
            done: 0,
            total: p.totalStrategies,
            elapsedMs: 0,
            etaMs: 0,
            rate: 0,
          });
          setStatus(`Evaluating ${p.totalStrategies} strategies…`);
          break;
        }
        case "result": {
          const p = payload as {
            row: TournamentRow;
            done: number;
            total: number;
          };
          setLiveRows((prev) => [...prev, p.row]);
          setStatus(`Finished ${p.row.strategyName} (${p.done}/${p.total})`);
          break;
        }
        case "progress": {
          setProgress(payload as TournamentProgress);
          break;
        }
        case "done": {
          setData(payload as TournamentResult);
          setStatus("Completed");
          setIsPending(false);
          break;
        }
        case "error": {
          const p = payload as { message?: string };
          setIsError(true);
          setError(new Error(p.message ?? "Tournament failed"));
          setIsPending(false);
          break;
        }
      }
    }
  }, []);

  return {
    isPending,
    isError,
    error,
    status,
    progress,
    liveRows,
    data,
    start,
    cancel,
    reset,
  };
}
