import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import strategiesRouter from "./strategies";
import backtestRouter from "./backtest";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(strategiesRouter);
router.use(backtestRouter);

export default router;
