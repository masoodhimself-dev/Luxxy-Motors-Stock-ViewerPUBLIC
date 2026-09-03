import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import shareRouter from "./routes/share";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
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
// Mounted before the body parsers: the Clerk proxy streams raw bytes.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
//
// getClerkProxyHost is shared with clerkProxyMiddleware so that both
// halves of the auth setup agree on which hostname is canonical.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);
// Server-rendered link previews for shared vehicle URLs. Lives outside /api
// because the URL is handed to buyers, and is registered as its own path on
// this service in `.replit-artifact/artifact.toml`.
app.use("/share", shareRouter);

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
