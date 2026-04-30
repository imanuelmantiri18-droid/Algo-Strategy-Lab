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
- **Single Strategy** — pre-selects the tournament champion (`fractal_breakout`) on first load. Run-only UI (no per-strategy parameter knobs); shows metrics grid (with IS-vs-OOS delta indicators), equity curve, drawdown chart, **Monthly Returns Heatmap** (year × month grid, green-gain / red-loss intensity, OOS cells ringed in primary), **Win/Loss Breakdown card** (in-sample vs out-of-sample side-by-side: trades / wins / losses / win rate, long vs short, avg win/loss/PnL, biggest win, biggest loss, max win/loss streaks, avg holding hours, fees+funding cost, exit-reason histogram), and **Trade Log table** (window/result/side filters, paginated 25/page, color-coded side & PnL, exit-reason tags TP/SL/Sig/EOD/LIQ/Time, entry/exit timestamps and prices). Last selected strategy persisted in localStorage.

A global **ConfigBar** sits above the tabs and lets the user override three params: **timeframe** (15m / 30m / 1H / 2H / 4H / 1D), **leverage** (presets 3× / 5× / 10× / 20× + custom 1–125 number input), and **risk per trade %** (presets 1 / 2 / 5 / 10 + custom 0.5–50 number input). All other risk knobs (R:R, ATR, fees, funding, walk-forward split, lookback, capital) stay locked at the proven values defined in `DEFAULT_CONFIG`. ConfigBar state is persisted to `localStorage` (`strategyLab.config.v1`) and only the three editable fields are accepted on rehydrate. The header subtitle, footer risk label, Tournament card "Active config" line, and LabPage "Active config" line all derive from `deriveConfigSummary(config)` so they update live as the user changes settings. Reset button restores defaults.
- **Tournament** — runs every available strategy with default params on the same BTC window via **SSE streaming** (`/backtest/tournament/stream`): rows appear live in the leaderboard with a real-time progress bar, ETA, and Cancel button. Applies a max-drawdown filter (default 40%, computed as the **worst of |IS DD|, |OOS DD|**), scores by robustness (geometric mean of OOS/IS APY × OOS/IS Sharpe, clamped). Champion card highlights the best algorithm.
- **Optimizer** — axes-based grid sweep on a single strategy, up to 10,000 combos, with SSE progress bar/ETA, IS-vs-OOS scatter, top-100 leaderboard.
- **Compare** — up to 4 parameter presets head-to-head with overlaid equity/drawdown.

Defaults: **$1,000 capital · 5× leverage · 4h candles · 730-day lookback · ATR×1.5 stops · 1:2 R:R · train on 2024 / test on 2025+**. Leverage exposed as one-tap **3× / 5× / 10× presets** (Safe / Balanced / Aggressive) with custom slider override.

Mobile-first layout: stacked panels at phone width, two-column at `lg`. Granular per-stage loading panel with checked-off completed steps while the backend works.

### `api-server` (api, served at `/api`)
Express server with `compression` middleware (excluding SSE streams), `express-rate-limit` (general 120/min, heavy 12/min on `/optimize`, `/tournament`, `/compare`), and `trust proxy: 1` set for accurate per-IP throttling behind the workspace proxy. Routes: `/healthz`, `/market/btc?interval=&lookbackDays=`, `/strategies`, `/backtest/run`, `/backtest/optimize`, `/backtest/optimize/stream`, `/backtest/compare`, `/backtest/tournament`, `/backtest/tournament/stream` (SSE: `status` → `started` → `result` (per-strategy) → `progress` → `done`/`error`).

- `src/lib/marketData.ts` — fetches real BTC/USDT klines from `data-api.binance.vision` (Binance's market-data subdomain, accessible globally including Replit data centers; api.binance.com returns 451). Chunked backwards-pagination, **variable in-memory cache TTL (5 min for ≤1y lookbacks, 15 min for >1y since long-history backfills are stable)**, in-flight dedup. Supported intervals: `5m / 15m / 30m / 1h / 2h / 4h / 1d`.
- `src/lib/indicators.ts` — full TA library: `sma/ema/wma/hma/rsi/atr/bollinger/macd/adx/sar/ichimoku/supertrend/donchian/stoch/williamsR/cci/zscore/vwap/keltner/linRegSlope/heikinAshi`. All return Float64Array (or typed objects) operating on OHLCV arrays.
- `src/lib/strategies/{smc,trend,meanrev,breakout,orderflow,advanced}.ts` — one file per category, each exporting `Strategy[]` with `meta` + `generate()` returning `Signal[]` (-1/0/1). Strategies needing data we don't have (orderbook, funding, second asset, ML training) are stubbed with `meta.available = false` and a human-readable `unavailableReason`.
- `src/lib/strategies.ts` — registry that aggregates all 6 category files; exports `STRATEGIES`, `getStrategy`, `availableStrategies`, `strategyMetaList`, plus backward-compat shims (`closesArr`, `highsArr`, `lowsArr`, `ema`, `rsi`, `atr`).
- `src/lib/backtest.ts` — vectorized engine with realistic execution: ATR stop loss, R:R take-profit, maker fees on TP fills, taker fees + slippage on market/SL exits, liquidation at `(1/lev − 0.005)` move. **Same-bar reversals incur 1.5× slippage** (the new entry executes against the same liquidity as the forced exit, modelled by tracking `prevPos`). **Risk-per-trade %** sizes margin as a fraction of current equity (default 100% = legacy all-in). **Funding rate** charged every 8h while in position via per-interval bar count map. **Time stop** force-closes positions held longer than `maxHoldingBars` (exit reason `time_stop`). Walk-forward warm-up reserves `max(atrPeriod*3, 50)` bars before the IS window so indicators are populated. `splitIndex(candles, request)` resolves either `walkForwardSplit` (fraction) or `walkForwardSplitDate` (ISO date — strictly before = IS); OOS engine inherits IS final equity. **Robustness score** is the geometric mean of OOS/IS APY and OOS/IS Sharpe, clamped to [0, 1.5]. `runBacktestMetricsOnly` is the lean variant used by the optimizer and tournament.
- `src/routes/backtest.ts` — optimizer builds the cartesian product of arbitrary `axes` (capped at 10,000 combos), filters by max drawdown (the **worst of |IS DD|, |OOS DD|** — earlier versions only checked IS), sorts surviving rows by OOS APY then robustness, yields every 100 combos via `setImmediate`. Returns top-N kept rows (default 100). SSE `/optimize/stream` emits throttled `progress` events (~5/s) with done/total/elapsed/eta/rate; cancellation is detected via `res.on("close")` (NOT `req.on("close")` — Express 5 fires that on normal body completion too). Tournament loop is shared between blocking `POST /tournament` and streaming `POST /tournament/stream` via a `runTournamentLoop` helper that processes strategies in **batches of 8** with `setImmediate` yields. **/backtest/run downsamples** equity curve and candle arrays to ~2000 points before serializing (chart fidelity preserved, payload bounded).

API contract is defined in `lib/api-spec/openapi.yaml` (v0.2.0) and consumed via generated React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`). Regenerate with `pnpm --filter @workspace/api-spec run codegen`.
