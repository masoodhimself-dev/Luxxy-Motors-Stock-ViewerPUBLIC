import platformDealersRouter from "./routes/platform-dealers";
import { resolveTenant } from "./middlewares/tenant";
import { serveFrontend } from "./lib/serve-frontend";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import shareRouter from "./routes/share";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(/(\/api\/customer-sale\/|\/my-purchase\/)[^/]+/, '$1[private]'),
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
// Mounted before the body parsers: the Clerk proxy streams raw bytes.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "25mb", verify: (req, _res, buffer) => {
  if (req.url?.split('?')[0] === '/api/reservations/stripe/webhook') (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
} }));
app.use(express.urlencoded({ extended: true }));

app.use(clerkMiddleware({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY }));

app.use("/api/platform", platformDealersRouter);
app.use(resolveTenant);
app.use("/api", router);
app.use(['/my-purchase', '/reserve/payment-return'], (_req, res, next) => { res.set({ 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' }); next(); });
// Server-rendered link previews for shared vehicle URLs. Lives outside /api
// because the URL is handed to buyers.
app.use("/share", shareRouter);
app.use(["/api", "/share"], (_req, res) => { res.status(404).json({ error: "Not found" }); });
if (process.env.FRONTEND_DIST_DIR) serveFrontend(app, process.env.FRONTEND_DIST_DIR);

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ err: error }, "Unhandled API error");
  if (res.headersSent) return;

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as SyntaxError & { status?: number }).status === 400
  ) {
    res.status(400).json({
      status: "rejected",
      errors: [
        {
          code: "invalid_json",
          message: "Request body is not valid JSON",
          path: null,
          advertId: null,
        },
      ],
    });
    return;
  }

  res.status(500).json({
    status: "rejected",
    errors: [
      {
        code: "unexpected_error",
        message: "Internal server error",
        path: null,
        advertId: null,
      },
    ],
  });
});

export default app;
