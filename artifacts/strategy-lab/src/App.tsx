import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LabPage } from "@/pages/LabPage";
import { OptimizerPage } from "@/pages/OptimizerPage";
import { ComparePage } from "@/pages/ComparePage";
import { DEFAULT_CONFIG, type LabConfig } from "@/components/LabControls";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

type TabKey = "lab" | "optimizer" | "compare";

function Shell() {
  const [tab, setTab] = useState<TabKey>("lab");
  const [config, setConfig] = useState<LabConfig>(DEFAULT_CONFIG);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});

  return (
    <div className="min-h-screen w-full text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-primary/15 border border-primary/40 flex items-center justify-center font-mono text-primary text-sm font-bold glow-primary shrink-0">
              SL
            </div>
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-semibold leading-tight truncate">
                Strategy Lab
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground font-mono leading-tight truncate">
                Real BTC/USDT · Binance · Walk-forward backtests
              </div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              v0.2
            </span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary">
              ENGINE LIVE
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-4 sm:py-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
          <TabsList className="grid grid-cols-3 w-full sm:w-auto sm:inline-grid mb-4 font-mono uppercase text-[11px] tracking-wider">
            <TabsTrigger value="lab">Lab</TabsTrigger>
            <TabsTrigger value="optimizer">Optimizer</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
          </TabsList>
          <TabsContent value="lab" className="mt-0">
            <LabPage
              config={config}
              onConfigChange={setConfig}
              paramValues={paramValues}
              onParamsChange={setParamValues}
            />
          </TabsContent>
          <TabsContent value="optimizer" className="mt-0">
            <OptimizerPage
              interval={config.interval}
              lookbackDays={config.lookbackDays}
              initialCapital={config.initialCapital}
              onApplyBest={({ params, risk }) => {
                setParamValues(params);
                setConfig((c) => ({ ...c, risk: { ...c.risk, ...risk } }));
                setTab("lab");
              }}
            />
          </TabsContent>
          <TabsContent value="compare" className="mt-0">
            <ComparePage
              interval={config.interval}
              lookbackDays={config.lookbackDays}
              initialCapital={config.initialCapital}
            />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mx-auto max-w-7xl px-3 sm:px-6 py-6 text-[10px] sm:text-xs text-muted-foreground/80 font-mono leading-relaxed">
        Real BTC/USDT klines from Binance public API · Maker {DEFAULT_CONFIG.risk.makerFeePct}% / Taker {DEFAULT_CONFIG.risk.takerFeePct}% fees · {DEFAULT_CONFIG.risk.slippagePct}% slippage on market orders · ATR-based stops with R:R take-profit · Walk-forward in-sample / out-of-sample validation. Past performance does not guarantee future results. For research only.
      </footer>

      <Toaster />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Shell />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
