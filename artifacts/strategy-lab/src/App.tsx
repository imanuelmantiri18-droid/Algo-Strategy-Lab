import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LabPage } from "@/pages/LabPage";
import { OptimizerPage } from "@/pages/OptimizerPage";
import { ComparePage } from "@/pages/ComparePage";

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
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("moonshot");

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
                Leveraged backtests · BTC · 5y synthetic
              </div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              v0.1
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
              selectedId={selectedStrategyId}
              onSelect={setSelectedStrategyId}
            />
          </TabsContent>
          <TabsContent value="optimizer" className="mt-0">
            <OptimizerPage
              selectedId={selectedStrategyId}
              onSelect={setSelectedStrategyId}
              onApplyBest={({ strategyId }) => {
                setSelectedStrategyId(strategyId);
                setTab("lab");
              }}
            />
          </TabsContent>
          <TabsContent value="compare" className="mt-0">
            <ComparePage />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mx-auto max-w-7xl px-3 sm:px-6 py-6 text-[10px] sm:text-xs text-muted-foreground/80 font-mono leading-relaxed">
        Synthetic BTC history · Linear-leverage model · Per-side fee 0.06% · Liquidation buffer 5%.
        Past performance of synthetic backtests does not guarantee future results. For research only.
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
