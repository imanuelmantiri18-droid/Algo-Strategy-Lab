import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LabPage } from "@/pages/LabPage";
import { TournamentPage } from "@/pages/TournamentPage";
import { LiveMonitor } from "@/components/LiveMonitor";
import {
  DEFAULT_CONFIG,
  FIXED_CONFIG_SUMMARY,
  deriveConfigSummary,
  type LabConfig,
} from "@/components/LabControls";
import { ConfigBar } from "@/components/ConfigBar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const LAST_STRATEGY_KEY = "strategyLab.lastStrategyId";
const CONFIG_KEY = "strategyLab.config.v1";

function loadStoredConfig(): LabConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<LabConfig> & {
      risk?: Partial<LabConfig["risk"]>;
    };
    // Only allow the four editable fields to override defaults.
    return {
      ...DEFAULT_CONFIG,
      interval: parsed.interval ?? DEFAULT_CONFIG.interval,
      initialCapital:
        typeof parsed.initialCapital === "number" && parsed.initialCapital > 0
          ? parsed.initialCapital
          : DEFAULT_CONFIG.initialCapital,
      risk: {
        ...DEFAULT_CONFIG.risk,
        leverage: parsed.risk?.leverage ?? DEFAULT_CONFIG.risk.leverage,
        riskPerTradePct:
          parsed.risk?.riskPerTradePct ?? DEFAULT_CONFIG.risk.riskPerTradePct,
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

type TabKey = "lab" | "tournament" | "live";

function Shell() {
  const [tab, setTab] = useState<TabKey>("tournament");
  const [config, setConfig] = useState<LabConfig>(loadStoredConfig);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});

  // Persist editable config so it survives reloads.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        CONFIG_KEY,
        JSON.stringify({
          interval: config.interval,
          initialCapital: config.initialCapital,
          risk: {
            leverage: config.risk.leverage,
            riskPerTradePct: config.risk.riskPerTradePct,
          },
        }),
      );
    } catch {
      // ignore
    }
  }, [config]);

  const isDefaultConfig = useMemo(
    () =>
      config.interval === DEFAULT_CONFIG.interval &&
      config.initialCapital === DEFAULT_CONFIG.initialCapital &&
      config.risk.leverage === DEFAULT_CONFIG.risk.leverage &&
      config.risk.riskPerTradePct === DEFAULT_CONFIG.risk.riskPerTradePct,
    [config],
  );

  const summary = useMemo(() => deriveConfigSummary(config), [config]);
  const headerSubtitle = `BTC/USDT · ${summary.intervalLabel} · ${config.risk.leverage}× · ${config.risk.riskPerTradePct}% risk`;
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(LAST_STRATEGY_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (selectedStrategyId)
        window.localStorage.setItem(LAST_STRATEGY_KEY, selectedStrategyId);
    } catch {
      // ignore
    }
  }, [selectedStrategyId]);

  return (
    <div className="min-h-screen w-full text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-6xl px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-primary/15 border border-primary/40 flex items-center justify-center font-mono text-primary text-sm font-bold glow-primary shrink-0">
              SL
            </div>
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-semibold leading-tight truncate">
                Strategy Lab
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground font-mono leading-tight truncate">
                {headerSubtitle} · {FIXED_CONFIG_SUMMARY.splitLabel}
              </div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary">
              ENGINE LIVE
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 sm:px-6 py-4 sm:py-6">
        <ConfigBar
          config={config}
          onChange={setConfig}
          onReset={() => setConfig(DEFAULT_CONFIG)}
          isDefault={isDefaultConfig}
        />
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
          <TabsList className="grid grid-cols-3 w-full sm:w-auto sm:inline-grid mb-4 font-mono uppercase text-[11px] tracking-wider">
            <TabsTrigger value="tournament">Tournament</TabsTrigger>
            <TabsTrigger value="lab">Single Strategy</TabsTrigger>
            <TabsTrigger value="live" className="relative">
              Live Bot
              <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="tournament" className="mt-0">
            <TournamentPage
              baseConfig={config}
              onApply={(strategyId) => {
                setSelectedStrategyId(strategyId);
                setParamValues({});
                setTab("lab");
              }}
            />
          </TabsContent>
          <TabsContent value="lab" className="mt-0">
            <LabPage
              config={config}
              paramValues={paramValues}
              onParamsChange={setParamValues}
              selectedStrategyId={selectedStrategyId}
              onSelectedStrategyIdChange={setSelectedStrategyId}
            />
          </TabsContent>
          <TabsContent value="live" className="mt-0">
            <LiveMonitor />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mx-auto max-w-6xl px-3 sm:px-6 py-6 text-[10px] sm:text-xs text-muted-foreground/80 font-mono leading-relaxed">
        Real BTC/USDT klines from Binance · {FIXED_CONFIG_SUMMARY.feeLabel} · {summary.riskLabel} · Walk-forward in-sample / out-of-sample. Past performance ≠ future results. Research only.
      </footer>

      <Toaster />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Shell />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
