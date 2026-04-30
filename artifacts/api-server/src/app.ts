import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the Replit proxy so rate-limit can read the real client IP from
// X-Forwarded-For. Setting `1` is the minimum-trust setting that satisfies
// express-rate-limit's IPv6-correctness check.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// gzip JSON responses (notably big backtest payloads with full equity curves).
// SSE streams are excluded — flushing per-event matters more than compression.
app.use(
  compression({
    filter: (req, res) => {
      const ct = String(res.getHeader("Content-Type") ?? "");
      if (ct.includes("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Generic per-IP rate limit for all /api routes.
const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

// Tighter limit for the heavy compute endpoints.
const heavyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: {
    error:
      "Too many heavy backtest requests in the last minute. Please wait and retry.",
  },
});

app.use("/api", generalLimiter);
// Heavy endpoints: optimize / tournament / compare. The general limiter still
// applies on top, but this caps the expensive ones much sooner.
app.use(
  [
    "/api/backtest/optimize",
    "/api/backtest/optimize/stream",
    "/api/backtest/tournament",
    "/api/backtest/tournament/stream",
    "/api/backtest/compare",
  ],
  heavyLimiter,
);

app.use("/api", router);

export default app;
