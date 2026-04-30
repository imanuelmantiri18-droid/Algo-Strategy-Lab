import { Router, type IRouter } from "express";
import { GetBtcDataQueryParams } from "@workspace/api-zod";
import { getBtcHistory } from "../lib/marketData";
import type { Interval } from "../types/strategy";

const router: IRouter = Router();

router.get("/market/btc", async (req, res, next) => {
  const parsed = GetBtcDataQueryParams.safeParse({
    interval: req.query.interval,
    lookbackDays: req.query.lookbackDays
      ? Number(req.query.lookbackDays)
      : undefined,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  const interval = parsed.data.interval as Interval;
  const lookbackDays = parsed.data.lookbackDays ?? 365;
  try {
    const candles = await getBtcHistory(interval, lookbackDays);
    res.json({
      symbol: "BTCUSDT",
      interval,
      source: "binance",
      candles,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
