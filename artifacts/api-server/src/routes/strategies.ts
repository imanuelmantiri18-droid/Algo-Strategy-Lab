import { Router, type IRouter } from "express";
import { strategyMetaList } from "../lib/strategies";

const router: IRouter = Router();

router.get("/strategies", (req, res) => {
  res.json({ strategies: strategyMetaList() });
});

export default router;
