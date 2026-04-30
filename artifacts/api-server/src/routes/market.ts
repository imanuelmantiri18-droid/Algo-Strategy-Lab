import { Router, type IRouter } from "express";
import { GetBtcDataQueryParams } from "@workspace/api-zod";
import { getBtcHistory } from "../lib/marketData";

const router: IRouter = Router();

router.get("/market/btc", (req, res) => {
  const parsed = GetBtcDataQueryParams.safeParse({
    days: req.query.days ? Number(req.query.days) : undefined,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  const days = parsed.data.days ?? 365;
  const candles = getBtcHistory(days);
  res.json({ symbol: "BTCUSD", candles });
});

export default router;
