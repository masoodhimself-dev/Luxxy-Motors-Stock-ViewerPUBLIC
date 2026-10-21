import demoOnboardingRouter from './routes/demo-onboarding';
import platformDealersRouter from "./routes/platform-dealers";
import { resolveTenant } from "./middlewares/tenant";
import { serveFrontend } from "./lib/serve-frontend";
import { isPrivateTestDriveDeclarationPath, privateRequestLogUrl, protectPrivateCapabilityPages } from './middlewares/private-capability';
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import shareRouter from "./routes/share";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { importAdmission } from './lib/stock-import-admission';
import { serviceLifecycle } from './lib/service-lifecycle';
import seoRouter from './routes/seo';
import indexNowRouter from './routes/indexnow';
import { seoPrivatePageHeaders } from './lib/seo-crawl';
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
// Before body buffering, tenant lookups and authentication/provider work.
app.use(serviceLifecycle.middleware);
app.use(seoPrivatePageHeaders);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: privateRequestLogUrl(req.url),
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
protectPrivateCapabilityPages(app);
// Mounted before the body parsers: the Clerk proxy streams raw bytes.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(importAdmission.middleware);
app.use("/api/demo-onboarding", express.json({ limit: "450kb" }));
app.use("/api/service-book-upload", express.json({ limit: "2200kb" }));
app.use('/api/staff/website-assets', express.json({ limit: '3mb' }));
app.use(express.json({ limit: "25mb", verify: (req, _res, buffer) => {
  if (req.url?.split('?')[0] === '/api/reservations/stripe/webhook') (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
} }));
app.use(express.urlencoded({ extended: true }));

app.use(clerkMiddleware({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY }));

app.use("/api/demo-onboarding", demoOnboardingRouter);
app.use("/api/platform", platformDealersRouter);
app.use(resolveTenant);
app.use(seoRouter);
app.use(indexNowRouter);
app.use("/api", router);
// Server-rendered link previews for shared vehicle URLs. Lives outside /api
// because the URL is handed to buyers.
app.use("/share", shareRouter);
app.use(["/api", "/share"], (_req, res) => { res.status(404).json({ error: "Not found" }); });
if (process.env.FRONTEND_DIST_DIR) serveFrontend(app, process.env.FRONTEND_DIST_DIR);

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if(isPrivateTestDriveDeclarationPath(req.path)) req.log.warn('Private test-drive declaration request failed');
  else if(req.path.startsWith('/api/demo-onboarding')) req.log.warn('Demo onboarding request failed');
  else if(req.path === '/api/service-book-upload' || req.path.startsWith('/api/staff/inventory')) req.log.warn('Private inventory request failed');
  else req.log.error({ err: error }, "Unhandled API error");
  if (res.headersSent) return;

  const identity = /^\/api\/stock\/imports(?:\/|$)/.test(req.path) ? {
    runId: typeof req.body?.runId === "string" ? req.body.runId : null,
    retailerId: typeof req.body?.retailerId === "string" ? req.body.retailerId : null,
  } : {};
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    if(req.path.startsWith('/api/demo-onboarding')){res.status(413).json({error:'Onboarding request exceeds the 450 KB limit.'});return;}
    if(req.path === '/api/service-book-upload'){res.status(413).json({error:'Compressed upload exceeds the 2.2 MB request limit.'});return;}
    if(req.path === '/api/staff/website-assets'){res.status(413).json({error:'Image upload exceeds the 3 MB request limit. Choose a smaller image.'});return;}
    res.status(413).json({ ...identity, status: "rejected", errors: [{ code: "payload_too_large", message: "Request exceeds the 25 MB limit", path: null, advertId: null }] });
    return;
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as SyntaxError & { status?: number }).status === 400
  ) {
    res.status(400).json({
      ...identity, status: "rejected",
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
    ...identity, status: "rejected",
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
