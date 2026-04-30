# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### `strategy-lab` (web, served at `/`)
Algorithmic trading strategy lab for **real BTC/USDT** futures backtesting (Binance public data). Single strategy: **Momentum Trend Crossover** (EMA fast/slow crossover gated by RSI(14) momentum filter). Risk model: ATR-based dynamic stop loss with R:R-ratio take-profit (min 1:2), maker/taker fees, slippage on market & SL exits, liquidation modeling. Walk-forward validation splits each backtest into in-sample / out-of-sample periods with a robustness score. Three tabs:
- **Lab** — single walk-forward backtest with metrics grid (overall + IS / OOS panels), equity curve, drawdown, price+entries chart, and per-trade table (with stop/TP/fee/sample columns).
- **Optimizer** — axes-based grid sweep (any combination of `emaFast`, `emaSlow`, `rsiThreshold`, `atrMultiplierSL`, `riskRewardRatio`, `leverage`) up to 10,000 combos, with a max-drawdown filter, IS-vs-OOS scatter plot, and one-click "Apply to Lab".
- **Compare** — up to 4 parameter presets head-to-head on the same BTC history with overlaid equity/drawdown charts and side-by-side metrics including robustness score.

Defaults: **$1,000 capital · 10× leverage · 1h candles · 365-day lookback · ATR×1.5 stops · 1:2 R:R · maker 0.01% / taker 0.035% / slippage 0.05% · 70/30 walk-forward split**.

Mobile-first layout: stacked panels at phone width, two-column at `lg`. Granular per-stage loading panel with checked-off completed steps while the backend works.

### `api-server` (api, served at `/api`)
Express server. Routes: `/healthz`, `/market/btc?interval=&lookbackDays=`, `/strategies`, `/backtest/run`, `/backtest/optimize`, `/backtest/compare`.

- `src/lib/marketData.ts` — fetches real BTC/USDT klines from `data-api.binance.vision` (Binance's market-data subdomain, accessible globally including Replit data centers; api.binance.com returns 451). Chunked backwards-pagination, 5-minute in-memory cache, in-flight dedup. Supported intervals: `5m / 15m / 30m / 1h / 2h / 4h / 1d`.
- `src/lib/strategies.ts` — single strategy `momentum_trend_cross` plus exported `ema`, `rsi`, `atr` Float64Array helpers.
- `src/lib/backtest.ts` — vectorized engine with realistic execution: ATR stop loss, R:R take-profit, maker fees on TP fills, taker fees + slippage on market/SL exits, liquidation at `(1/lev − 0.005)` move. Walk-forward `splitIndex` helper runs IS then OOS in sequence with the OOS engine inheriting IS final equity. `runBacktestMetricsOnly` is the lean variant used by the optimizer.
- `src/routes/backtest.ts` — optimizer builds the cartesian product of arbitrary `axes` (capped at 10,000 combos), filters out combos whose in-sample max drawdown exceeds a configurable threshold (default 40%), sorts surviving rows by OOS APY then robustness, and yields to the event loop every 32 combos via `setImmediate` so other requests stay responsive.

API contract is defined in `lib/api-spec/openapi.yaml` (v0.2.0) and consumed via generated React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`). Regenerate with `pnpm --filter @workspace/api-spec run codegen`.
