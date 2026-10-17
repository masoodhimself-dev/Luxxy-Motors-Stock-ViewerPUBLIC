import { startStaffPushWorker } from './lib/staff-push';
import { startDemoCompletionWorker } from './lib/demo-completion-jobs';
import { startDomainSetupWorker } from './lib/domain-setup-jobs';
import { forEachActiveDealer } from './lib/tenant-jobs';
import { siteOrigin } from "./lib/enquiry-links";
import app from "./app";
import { startRetentionWorker } from "./lib/data-retention";
import { logger } from "./lib/logger";
import { startReminderWorker } from "./lib/enquiry-notifications";
import { startStripeReservationWorker } from './lib/stripe-reservation-worker';
import { backfillLeadsFromEnquiries } from "./lib/leads";

// Validate public links before listening or starting background database work.
siteOrigin();

const rawPort = process.env["PORT"] ?? "8080";

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startRetentionWorker(logger);
  startDemoCompletionWorker(logger);
  const stopDomainSetup = startDomainSetupWorker(logger);
  process.once('SIGTERM', stopDomainSetup);
  process.once('SIGINT', stopDomainSetup);
  startReminderWorker(logger);
  const stopStaffPush = startStaffPushWorker(logger);
  process.once('SIGTERM', stopStaffPush);
  process.once('SIGINT', stopStaffPush);
  startStripeReservationWorker(logger);
  // Enquiries taken before leads existed are carried across on boot. This is
  // idempotent, so it is safe on every restart.
  forEachActiveDealer(() => backfillLeadsFromEnquiries(logger)).catch((err: unknown) => {
    logger.error(
      { err },
      "Unable to carry existing enquiries across into leads",
    );
  });
});
