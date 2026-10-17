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
import { pool } from '@workspace/db';
import { serviceLifecycle } from './lib/service-lifecycle';
import { createShutdown, installShutdownSignals } from './lib/shutdown';
import { startEmailOutboxWorker } from './lib/email-outbox';

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

const stopWorkers: Array<() => void> = [];
const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  if (serviceLifecycle.isDraining()) return;
  logger.info({ port }, "Server listening");
  stopWorkers.push(
    startRetentionWorker(logger),
    startDemoCompletionWorker(logger),
    startDomainSetupWorker(logger),
    startReminderWorker(logger),
    startEmailOutboxWorker(logger),
    startStaffPushWorker(logger),
    startStripeReservationWorker(logger),
  );
  // Enquiries taken before leads existed are carried across on boot. This is
  // idempotent, so it is safe on every restart.
  forEachActiveDealer(() => backfillLeadsFromEnquiries(logger), { name: 'lead-backfill', log: logger }).catch((err: unknown) => {
    logger.error(
      { err },
      "Unable to carry existing enquiries across into leads",
    );
  });
});

installShutdownSignals(createShutdown({
  server, lifecycle: serviceLifecycle, stopWorkers,
  closePool: () => pool.end(), log: logger,
  exit: code => process.exit(code),
}));
