import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import shareRouter from "./routes/share";
import { logger } from "./lib/logger";

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
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

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
