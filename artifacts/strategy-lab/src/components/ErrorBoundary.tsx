import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  /** Optional custom render. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = { error: Error | null };

/**
 * Top-level error boundary. Catches render-time and lifecycle errors anywhere
 * below it and shows a recovery panel instead of a blank screen. Errors thrown
 * inside event handlers / async callbacks are NOT caught by React — those are
 * surfaced via the React Query error states or window.onerror.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-md w-full rounded-lg border border-destructive/40 bg-card/60 p-6 space-y-4">
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-destructive">
              Strategy Lab crashed
            </div>
            <div className="text-base font-semibold leading-snug">
              Something went wrong rendering this view.
            </div>
          </div>
          <pre className="rounded border border-border/60 bg-background/80 p-3 text-[11px] font-mono text-red-300 overflow-x-auto whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={this.reset}
              className="font-mono uppercase tracking-wider"
            >
              Try again
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
              className="font-mono uppercase tracking-wider"
            >
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
