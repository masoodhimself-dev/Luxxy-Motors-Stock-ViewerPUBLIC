import { startCustomerReplyWorker } from './lib/customer-email-replies';
import { startStaffPushWorker } from './lib/staff-push';
import { startDemoCompletionWorker } from './lib/demo-completion-jobs';
import { startDomainSetupWorker } from './lib/domain-setup-jobs';
import { forEachActiveDealer } from './lib/tenant-jobs';
import { siteOrigin } from "./lib/enquiry-links";
import app from "./app";
import { startRetentionWorker } from "./lib/data-retention";
import { logger } from "./lib/logger";
import { startReminderWorker } from "./lib/enquiry-notifications";
import { backfillLeadsFromEnquiries } from "./lib/leads";
import { pool } from '@workspace/db';
import { serviceLifecycle } from './lib/service-lifecycle';
import { createShutdown, installShutdownSignals } from './lib/shutdown';
import { startEmailOutboxWorker } from './lib/email-outbox';
import { createPostgresCazooFeedRepository, startCazooFeedCollector } from './lib/cazoo-feed-collector';

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
    startCustomerReplyWorker(logger),
    startStaffPushWorker(logger),
  );
  // Separate collection-only feature gate. Import acceptance remains independent.
  if (process.env.CAZOO_SFTP_ENABLED === 'true') {
    void serviceLifecycle.track(async () => {
      const repository = await createPostgresCazooFeedRepository();
      if (!serviceLifecycle.isDraining()) stopWorkers.push(startCazooFeedCollector({
        repository,
        onError: () => logger.warn('Cazoo stock collection could not complete. Stock has not been imported.'),
        onCheck: summary => {
          if (summary.status === 'blocked' || (summary.status === 'failed' && summary.attempts >= 3)) logger.warn(summary, 'Cazoo collection needs review. Stock has not been imported.');
          else if (summary.status === 'ready' || summary.status === 'unchanged') logger.info(summary, 'Cazoo stock file checked. Stock has not been imported.');
        },
      }));
    }).catch(() => logger.warn('Cazoo stock collection could not start. Stock has not been imported.'));
  }
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
