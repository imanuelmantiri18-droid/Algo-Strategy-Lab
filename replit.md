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
Algorithmic trading strategy lab for **real BTC/USDT** futures backtesting (Binance public data). **Library of 51 strategies** organized into 6 categories — pick one in the Lab, or run them all simultaneously in the Tournament:
- **SMC** (10) — Smart Money Concepts: order blocks, liquidity sweeps, FVGs, BOS/CHOCH, breaker blocks, Asian killzone, inducement.
- **Trend** (10) — EMA cross, MACD, Supertrend, ADX, Donchian, Ichimoku, HMA, parabolic SAR, regression slope, Heikin Ashi (+ legacy `momentum_trend_cross`).
- **Mean Reversion** (10) — RSI extremes, Bollinger fade, Keltner, Z-score, VWAP fade, stoch divergence, Williams %R, CCI reject, BB squeeze.
- **Breakout/Volatility** (10) — Donchian breakout, ATR squeeze, opening range, Darvas, fractal, NR4/NR7, volume spike, channel break.
- **Order Flow** (5) — CVD divergence (proxy from candle flow), grid bot, volume profile POC. Order book and funding-rate strategies marked unavailable in this lab.
- **Advanced** (5) — Hidden Markov regime model, ARIMA mean reversion. Pairs trade, sentiment, and random-forest models marked unavailable.

Risk model: ATR stop loss + R:R take-profit (min 1:2), maker/taker fees, slippage on market & SL exits, liquidation modeling. Walk-forward validation splits each backtest into in-sample / out-of-sample windows by **either a percentage split or an explicit ISO date** (e.g. train on BTC 2024, test on 2025+). Four tabs:
- **Lab** — single backtest with grouped strategy picker (showing 6 categories, risk badges, unavailable reasons), metrics grid, equity curve, drawdown, price+entries chart, per-trade table.
- **Tournament** — runs every available strategy with default params on the same BTC window, applies a max-drawdown filter (default 40%), scores by robustness (OOS APY × consistency), and shows a sortable leaderboard with category filters and "Open in Lab" one-click handoff. Champion card highlights the best algorithm.
- **Optimizer** — axes-based grid sweep on a single strategy, up to 10,000 combos, with SSE progress bar/ETA, IS-vs-OOS scatter, top-100 leaderboard.
- **Compare** — up to 4 parameter presets head-to-head with overlaid equity/drawdown.

Defaults: **$1,000 capital · 5× leverage · 4h candles · 730-day lookback · ATR×1.5 stops · 1:2 R:R · train on 2024 / test on 2025+**. Leverage exposed as one-tap **3× / 5× / 10× presets** (Safe / Balanced / Aggressive) with custom slider override.

Mobile-first layout: stacked panels at phone width, two-column at `lg`. Granular per-stage loading panel with checked-off completed steps while the backend works.

### `api-server` (api, served at `/api`)
Express server. Routes: `/healthz`, `/market/btc?interval=&lookbackDays=`, `/strategies`, `/backtest/run`, `/backtest/optimize`, `/backtest/optimize/stream` (SSE: `status` → `started` → `progress` → `done`/`error`), `/backtest/compare`, `/backtest/tournament`.

- `src/lib/marketData.ts` — fetches real BTC/USDT klines from `data-api.binance.vision` (Binance's market-data subdomain, accessible globally including Replit data centers; api.binance.com returns 451). Chunked backwards-pagination, 5-minute in-memory cache, in-flight dedup. Supported intervals: `5m / 15m / 30m / 1h / 2h / 4h / 1d`.
- `src/lib/indicators.ts` — full TA library: `sma/ema/wma/hma/rsi/atr/bollinger/macd/adx/sar/ichimoku/supertrend/donchian/stoch/williamsR/cci/zscore/vwap/keltner/linRegSlope/heikinAshi`. All return Float64Array (or typed objects) operating on OHLCV arrays.
- `src/lib/strategies/{smc,trend,meanrev,breakout,orderflow,advanced}.ts` — one file per category, each exporting `Strategy[]` with `meta` + `generate()` returning `Signal[]` (-1/0/1). Strategies needing data we don't have (orderbook, funding, second asset, ML training) are stubbed with `meta.available = false` and a human-readable `unavailableReason`.
- `src/lib/strategies.ts` — registry that aggregates all 6 category files; exports `STRATEGIES`, `getStrategy`, `availableStrategies`, `strategyMetaList`, plus backward-compat shims (`closesArr`, `highsArr`, `lowsArr`, `ema`, `rsi`, `atr`).
- `src/lib/backtest.ts` — vectorized engine with realistic execution: ATR stop loss, R:R take-profit, maker fees on TP fills, taker fees + slippage on market/SL exits, liquidation at `(1/lev − 0.005)` move. `splitIndex(candles, request)` resolves either `walkForwardSplit` (fraction) or `walkForwardSplitDate` (ISO date — strictly before = IS) so OOS engine inherits IS final equity. `runBacktestMetricsOnly` is the lean variant used by the optimizer and tournament.
- `src/routes/backtest.ts` — optimizer builds the cartesian product of arbitrary `axes` (capped at 10,000 combos), filters by max IS drawdown, sorts surviving rows by OOS APY then robustness, yields every 100 combos via `setImmediate`. Returns top-N kept rows (default 100). SSE `/optimize/stream` emits throttled `progress` events (~5/s) with done/total/elapsed/eta/rate; cancellation is detected via `res.on("close")` (NOT `req.on("close")` — Express 5 fires that on normal body completion too). Tournament endpoint runs every available strategy with default params, applies max-DD filter (default 40%), and ranks by robustness score.

API contract is defined in `lib/api-spec/openapi.yaml` (v0.2.0) and consumed via generated React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`). Regenerate with `pnpm --filter @workspace/api-spec run codegen`.
