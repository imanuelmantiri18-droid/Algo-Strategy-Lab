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
Algorithmic trading strategy lab. Backtests 5 strategies (EMA crossover, RSI revert, Donchian breakout, N-day momentum, Moonshot) on 5 years of synthetic BTC OHLC, with leverage (1–50x), stop-loss, take-profit, fees, and liquidation modeling. Three tabs:
- **Lab** — single backtest with full equity curve, drawdown, price+entries chart, and per-trade table.
- **Optimizer** — sweeps leverage × SL × TP grid, ranks combos, and surfaces best config (one click to apply to Lab).
- **Compare** — runs up to 4 presets head-to-head with overlaid equity/drawdown charts.

Mobile-first layout: stacked panels at phone width, two-column at `lg`. Loading panel with progress + rotating step messages while backtests run.

### `api-server` (api, served at `/api`)
Express server. Routes: `/healthz`, `/market/btc`, `/strategies`, `/backtest/run`, `/backtest/optimize`, `/backtest/compare`. Backtest engine in `src/lib/backtest.ts`; strategies in `src/lib/strategies.ts`; synthetic seeded BTC market data in `src/lib/marketData.ts`.

API contract is defined in `lib/api-spec/openapi.yaml` and consumed via generated React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`). Regenerate with `pnpm --filter @workspace/api-spec run codegen`.
