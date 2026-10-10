import { forEachActiveDealer } from './tenant-jobs';
import { and as tenantAnd, eq as tenantEq } from "drizzle-orm";
import { currentDealerId, multiTenantEnabled } from "./tenant-context";
import { sendEmail, renderDealerEmail } from "./email-provider";
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  lt,
  lte,
  or,
  type AnyColumn,
} from "drizzle-orm";
import {
  db,
  dealerSettingsTable,
  enquiriesTable,
  enquiryEventsTable,
  type Enquiry,
} from "@workspace/db";
import type { Logger } from "pino";
import { notificationVersion, viewingCalendarIcs, viewingManageUrl } from "./enquiry-links";

export const bookingTimezone = "Europe/London";
const reminderLeadTimeMs = 24 * 60 * 60 * 1000;
const deliveryLeaseMs = 15 * 60 * 1000;

type DeliveryResult = {
  status: "sent" | "failed";
  error: string | null;
  sentAt: Date | null;
  providerId: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatAppointment(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(value);
}

type DealerProfile = {
  identity: { name: string };
  contact: { email: string; phone: string; whatsapp: string; address: string };
  instructions?: string;
  parkingInstructions?: string;
};

const defaultDealerProfile: DealerProfile = {
  identity: { name: "Used Car Showroom" },
  contact: { email: "", phone: "", whatsapp: "", address: "" },
};

type DealerSettingsConfig = {
  testDriveBooking?: { instructions?: string };
  presentation?: { parkingInstructions?: string; visitInstructions?: string };
  identity?: { name?: string };
  contact?: { email?: string; phone?: string; whatsapp?: string };
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postcode?: string;
  };
};

function formatAddress(address: DealerSettingsConfig["address"]) {
  return [address?.street, address?.city, address?.region, address?.postcode]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

async function getDealerProfile(): Promise<DealerProfile> {
  const [settings] = await db
    .select({ config: dealerSettingsTable.config })
    .from(dealerSettingsTable)
    .where(
      eq(
        dealerSettingsTable.dealerId,
        currentDealerId(),
      ),
    );
  const config = settings?.config as DealerSettingsConfig | undefined;
  return {
    instructions: config?.testDriveBooking?.instructions?.trim() || config?.presentation?.visitInstructions?.trim() || "",
    parkingInstructions: config?.presentation?.parkingInstructions?.trim() || "",
    identity: {
      name: config?.identity?.name?.trim() || defaultDealerProfile.identity.name,
    },
    contact: {
      email: config?.contact?.email?.trim() || defaultDealerProfile.contact.email,
      phone: config?.contact?.phone?.trim() || defaultDealerProfile.contact.phone,
      whatsapp:
        config?.contact?.whatsapp?.trim() || defaultDealerProfile.contact.whatsapp,
      address: formatAddress(config?.address),
    },
  };
}

/** The dealer's public identity and contact details, as used in emails. */
export async function dealerProfile(): Promise<DealerProfile> {
  return getDealerProfile();
}

function vehicleLabel(enquiry: Enquiry, dealerName: string) {
  return enquiry.vehicleTitle || `your ${dealerName} enquiry`;
}

async function attemptEmail({
  to,
  subject,
  html,
  idempotencyKey,
  missingRecipientMessage,
  log,
  enquiryId,
  logMessage,
  dealerName,
  attachments,
}: {
  to: string | null;
  subject: string;
  html: string;
  idempotencyKey: string;
  missingRecipientMessage: string;
  log: Logger;
  enquiryId: string;
  logMessage: string;
  dealerName: string;
  attachments?: Array<{ filename: string; content: string }>;
}): Promise<DeliveryResult> {
  if (!to) {
    return {
      status: "failed",
      error: missingRecipientMessage,
      sentAt: null,
      providerId: null,
    };
  }

  try {
    const providerId = await sendEmail(
      to,
      subject,
      html,
      idempotencyKey,
      dealerName,
      attachments,
    );
    return { status: "sent", error: null, sentAt: new Date(), providerId };
  } catch (error) {
    log.error({ err: error, enquiryId }, logMessage);
    return {
      status: "failed",
      error: "Resend could not deliver this email.",
      sentAt: null,
      providerId: null,
    };
  }
}

const contactMethodLabels: Record<string, string> = {
  email: "Email",
  phone: "Phone call",
  whatsapp: "WhatsApp",
};

const conditionLabels: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

function row(label: string, value: string | null | undefined) {
  if (!value) return "";
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function partExchangeSection(enquiry: Enquiry) {
  const details = [
    enquiry.partExchangeRegistration
      ? `Registration: ${enquiry.partExchangeRegistration}`
      : null,
    enquiry.partExchangeMileage != null
      ? `Mileage: ${new Intl.NumberFormat("en-GB").format(enquiry.partExchangeMileage)} miles`
      : null,
    enquiry.partExchangeCondition
      ? `Condition: ${conditionLabels[enquiry.partExchangeCondition] ?? enquiry.partExchangeCondition}`
      : null,
  ].filter((entry): entry is string => entry != null);
  if (details.length === 0) return "";
  return `<p><strong>Part exchange:</strong><br />${details
    .map((entry) => escapeHtml(entry))
    .join("<br />")}</p>`;
}

function appointmentState(enquiry: Enquiry) {
  return enquiry.appointmentCancelledAt ? "cancelled" : enquiry.appointmentStatus === "pending" ? "requested — awaiting confirmation" : "confirmed";
}

async function enquiryEmail(enquiry: Enquiry, dealer: DealerProfile, audience: 'customer' | 'dealer', reminder = false) {
  const isViewing = enquiry.type === 'viewing' && enquiry.appointmentAt != null;
  let moved = false;
  if (audience === 'customer' && isViewing && !reminder && !enquiry.appointmentCancelledAt && enquiry.appointmentStatus === 'confirmed' && enquiry.appointmentRevision > 0) {
    const [latest] = await db.select({ kind: enquiryEventsTable.kind }).from(enquiryEventsTable)
      .where(and(eq(enquiryEventsTable.dealerId, enquiry.dealerId), eq(enquiryEventsTable.enquiryId, enquiry.id)))
      .orderBy(desc(enquiryEventsTable.occurredAt)).limit(1);
    moved = latest?.kind === 'viewing_rescheduled';
  }
  const templateId = audience === 'dealer' ? 'dealer_notification' : isViewing
    ? enquiry.appointmentCancelledAt ? 'booking_cancellation'
      : enquiry.appointmentStatus === 'pending' ? 'booking_request'
      : reminder ? 'booking_reminder'
      : moved ? 'booking_change' : 'booking_confirmation'
    : enquiry.preferredContact === 'phone' && /^Callback requested at next opening/.test(enquiry.message) ? 'callback' : 'enquiry_acknowledgement';
  const facts = [
    { label: 'Reference', value: enquiry.reference },
    { label: 'Vehicle', value: vehicleLabel(enquiry, dealer.identity.name) },
    ...(isViewing ? [
      { label: 'Appointment status', value: appointmentState(enquiry) },
      { label: 'Appointment', value: `${formatAppointment(enquiry.appointmentAt)} (${bookingTimezone})` },
      { label: 'Duration', value: `${enquiry.appointmentDurationMinutes ?? 30} minutes` },
      ...(dealer.contact.address ? [{ label: 'Showroom', value: dealer.contact.address }] : []),
    ] : []),
    ...(audience === 'dealer' ? [
      { label: 'Customer', value: enquiry.customerName },
      { label: 'Phone', value: enquiry.phone ?? 'Not provided' },
      ...(enquiry.email ? [{ label: 'Email', value: enquiry.email }] : []),
      ...(enquiry.partExchangeRegistration ? [{ label: 'Part-exchange registration', value: enquiry.partExchangeRegistration }] : []),
      ...(enquiry.partExchangeMileage != null ? [{ label: 'Part-exchange mileage', value: `${enquiry.partExchangeMileage} miles` }] : []),
    ] : []),
  ];
  return renderDealerEmail({ templateId, variables: {
    dealer_name: dealer.identity.name, dealer_email: dealer.contact.email,
    dealer_phone: dealer.contact.phone, dealer_address: dealer.contact.address,
    customer_name: enquiry.customerName, customer_email: enquiry.email ?? '',
    reference: enquiry.reference, vehicle_title: vehicleLabel(enquiry, dealer.identity.name),
    appointment_time: formatAppointment(enquiry.appointmentAt) ?? '', appointment_status: appointmentState(enquiry),
    duration: `${enquiry.appointmentDurationMinutes ?? 30} minutes`, visit_instructions: dealer.instructions ?? '',
    parking_instructions: dealer.parkingInstructions ?? '',
    manage_url: isViewing && !enquiry.appointmentCancelledAt ? viewingManageUrl(enquiry.id) ?? '' : '',
    message: enquiry.message, preferred_contact: enquiry.preferredContact ? contactMethodLabels[enquiry.preferredContact] ?? enquiry.preferredContact : '',
  }, facts });
}

function calendarAttachment(enquiry: Enquiry, dealer: DealerProfile) {
  if (enquiry.type !== "viewing" || !enquiry.appointmentAt) return undefined;
  const ics = viewingCalendarIcs({
    enquiry,
    dealerName: dealer.identity.name,
    location: dealer.contact.address,
  });
  if (!ics) return undefined;
  return [
    {
      filename: "viewing.ics",
      content: Buffer.from(ics, "utf8").toString("base64"),
    },
  ];
}

function claimable(
  status: AnyColumn,
  attemptedAt: AnyColumn,
  staleBefore: Date,
) {
  return or(
    eq(status, "pending"),
    and(
      eq(status, "sending"),
      or(isNull(attemptedAt), lt(attemptedAt, staleBefore)),
    ),
  );
}

async function processCustomerConfirmation(enquiry: Enquiry, log: Logger, dealer: DealerProfile) {
  const attemptedAt = new Date();
  const staleBefore = new Date(attemptedAt.getTime() - deliveryLeaseMs);
  const [claimed] = await db
    .update(enquiriesTable)
    .set({
      customerNotificationStatus: "sending",
      customerNotificationError: null,
      customerNotificationAttemptedAt: attemptedAt,
    })
    .where(
      and(
        eq(enquiriesTable.id, enquiry.id),
        eq(enquiriesTable.appointmentRevision, enquiry.appointmentRevision),
        claimable(
          enquiriesTable.customerNotificationStatus,
          enquiriesTable.customerNotificationAttemptedAt,
          staleBefore,
        ),
      ),
    )
    .returning();
  if (!claimed) return;

  const result = await attemptEmail({
    to: claimed.email,
    ...await enquiryEmail(claimed, dealer, 'customer'),
    idempotencyKey: `enquiry-${claimed.id}-customer-${notificationVersion(claimed)}`,
    dealerName: dealer.identity.name,
    missingRecipientMessage: "Customer email address is missing.",
    log,
    enquiryId: claimed.id,
    logMessage: "Customer confirmation delivery failed",
    attachments: calendarAttachment(claimed, dealer),
  });
  await db
    .update(enquiriesTable)
    .set({
      customerNotificationStatus: result.status,
      customerNotificationError: result.error,
      customerNotificationSentAt: result.sentAt,
      customerNotificationProviderId: result.providerId,
    })
    .where(
      and(
        eq(enquiriesTable.id, claimed.id),
        eq(enquiriesTable.appointmentRevision, claimed.appointmentRevision),
        eq(enquiriesTable.customerNotificationStatus, "sending"),
        eq(
          enquiriesTable.customerNotificationAttemptedAt,
          claimed.customerNotificationAttemptedAt!,
        ),
      ),
    );
}

async function processDealerNotification(enquiry: Enquiry, log: Logger, dealer: DealerProfile) {
  const attemptedAt = new Date();
  const staleBefore = new Date(attemptedAt.getTime() - deliveryLeaseMs);
  const [claimed] = await db
    .update(enquiriesTable)
    .set({
      dealerNotificationStatus: "sending",
      dealerNotificationError: null,
      dealerNotificationAttemptedAt: attemptedAt,
    })
    .where(
      and(
        eq(enquiriesTable.id, enquiry.id),
        eq(enquiriesTable.appointmentRevision, enquiry.appointmentRevision),
        claimable(
          enquiriesTable.dealerNotificationStatus,
          enquiriesTable.dealerNotificationAttemptedAt,
          staleBefore,
        ),
      ),
    )
    .returning();
  if (!claimed) return;

  const result = await attemptEmail({
    to: dealerNotificationRecipient(dealer.contact.email),
    ...await enquiryEmail(claimed, dealer, 'dealer'),
    idempotencyKey: `enquiry-${claimed.id}-dealer-${notificationVersion(claimed)}`,
    dealerName: dealer.identity.name,
    missingRecipientMessage: "Dealer notification email is not configured.",
    log,
    enquiryId: claimed.id,
    logMessage: "Dealer notification delivery failed",
  });
  await db
    .update(enquiriesTable)
    .set({
      dealerNotificationStatus: result.status,
      dealerNotificationError: result.error,
      dealerNotificationSentAt: result.sentAt,
      dealerNotificationProviderId: result.providerId,
    })
    .where(
      and(
        eq(enquiriesTable.id, claimed.id),
        eq(enquiriesTable.appointmentRevision, claimed.appointmentRevision),
        eq(enquiriesTable.dealerNotificationStatus, "sending"),
        eq(
          enquiriesTable.dealerNotificationAttemptedAt,
          claimed.dealerNotificationAttemptedAt!,
        ),
      ),
    );
}

export async function deliverEnquiryNotifications(
  enquiry: Enquiry,
  log: Logger,
) {
  const dealer = await getDealerProfile();
  await Promise.all([
    processCustomerConfirmation(enquiry, log, dealer),
    processDealerNotification(enquiry, log, dealer),
  ]);
  const [updated] = await db
    .select()
    .from(enquiriesTable)
    .where(tenantAnd(eq(enquiriesTable.id, enquiry.id), tenantEq(enquiriesTable.dealerId, currentDealerId())));
  return updated ?? enquiry;
}

async function processReminder(enquiry: Enquiry, log: Logger) {
  const dealer = await getDealerProfile();
  const attemptedAt = new Date();
  const staleBefore = new Date(attemptedAt.getTime() - deliveryLeaseMs);
  const [claimed] = await db
    .update(enquiriesTable)
    .set({
      reminderStatus: "sending",
      reminderError: null,
      reminderAttemptedAt: attemptedAt,
    })
    .where(
      and(
        eq(enquiriesTable.id, enquiry.id),
        eq(enquiriesTable.appointmentRevision, enquiry.appointmentRevision),
        eq(enquiriesTable.type, "viewing"),
        eq(enquiriesTable.appointmentStatus, "confirmed"),
        isNull(enquiriesTable.appointmentCancelledAt),
        gt(enquiriesTable.appointmentAt, attemptedAt),
        lte(enquiriesTable.appointmentAt, new Date(attemptedAt.getTime() + reminderLeadTimeMs)),
        claimable(
          enquiriesTable.reminderStatus,
          enquiriesTable.reminderAttemptedAt,
          staleBefore,
        ),
      ),
    )
    .returning();
  if (!claimed) return;

  const result = await attemptEmail({
    to: claimed.email,
    ...await enquiryEmail(claimed, dealer, 'customer', true),
    // Retries deduplicate, while a later change back to the same time is new.
    idempotencyKey: `enquiry-${claimed.id}-customer-reminder-${notificationVersion(claimed)}`,
    dealerName: dealer.identity.name,
    missingRecipientMessage: "Customer email address is missing.",
    log,
    enquiryId: claimed.id,
    logMessage: "Viewing reminder delivery failed",
    attachments: calendarAttachment(claimed, dealer),
  });
  await db
    .update(enquiriesTable)
    .set({
      reminderStatus: result.status,
      reminderError: result.error,
      reminderSentAt: result.sentAt,
      reminderProviderId: result.providerId,
    })
    .where(
      and(
        eq(enquiriesTable.id, claimed.id),
        eq(enquiriesTable.appointmentRevision, claimed.appointmentRevision),
        eq(enquiriesTable.appointmentStatus, "confirmed"),
        isNull(enquiriesTable.appointmentCancelledAt),
        eq(enquiriesTable.reminderStatus, "sending"),
        eq(
          enquiriesTable.reminderAttemptedAt,
          claimed.reminderAttemptedAt!,
        ),
      ),
    );
}

export async function processDueNotifications(log: Logger) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - deliveryLeaseMs);
  const pending = await db
    .select()
    .from(enquiriesTable)
    .where(
      and(eq(enquiriesTable.dealerId, currentDealerId()), or(
        claimable(
          enquiriesTable.customerNotificationStatus,
          enquiriesTable.customerNotificationAttemptedAt,
          staleBefore,
        ),
        claimable(
          enquiriesTable.dealerNotificationStatus,
          enquiriesTable.dealerNotificationAttemptedAt,
          staleBefore,
        ),
      )),
    );

  for (const enquiry of pending) {
    await deliverEnquiryNotifications(enquiry, log);
  }

  const dueBefore = new Date(now.getTime() + reminderLeadTimeMs);
  const reminders = await db
    .select()
    .from(enquiriesTable)
    .where(
      and(
        eq(enquiriesTable.dealerId, currentDealerId()),
        eq(enquiriesTable.type, "viewing"),
        or(eq(enquiriesTable.appointmentStatus, "confirmed"), isNull(enquiriesTable.appointmentStatus)),
        isNull(enquiriesTable.appointmentCancelledAt),
        claimable(
          enquiriesTable.reminderStatus,
          enquiriesTable.reminderAttemptedAt,
          staleBefore,
        ),
        gt(enquiriesTable.appointmentAt, now),
        lte(enquiriesTable.appointmentAt, dueBefore),
      ),
    );
  for (const enquiry of reminders) {
    await processReminder(enquiry, log);
  }

  await db
    .update(enquiriesTable)
    .set({
      reminderStatus: "failed",
      reminderError: "The appointment passed before a reminder could be sent.",
    })
    .where(
      and(
        eq(enquiriesTable.dealerId, currentDealerId()),
        eq(enquiriesTable.type, "viewing"),
        or(eq(enquiriesTable.appointmentStatus, "confirmed"), isNull(enquiriesTable.appointmentStatus)),
        isNull(enquiriesTable.appointmentCancelledAt),
        or(
          eq(enquiriesTable.reminderStatus, "pending"),
          and(
            eq(enquiriesTable.reminderStatus, "sending"),
            or(
              isNull(enquiriesTable.reminderAttemptedAt),
              lt(enquiriesTable.reminderAttemptedAt, staleBefore),
            ),
          ),
        ),
        lte(enquiriesTable.appointmentAt, now),
      ),
    );
}

/** A legacy server-wide recipient must never override another tenant's address. */
export function dealerNotificationRecipient(email?: string | null): string | null {
  return (!multiTenantEnabled() ? process.env.DEALER_NOTIFICATION_EMAIL?.trim() : '') || email?.trim() || null;
}

export function startReminderWorker(log: Logger) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    await forEachActiveDealer(() => processDueNotifications(log)).catch((error) => {
      log.error({ err: error }, "Notification worker failed");
    }).finally(() => { running = false; });
  };
  void run();
  const interval = setInterval(run, 5 * 60 * 1000);
  interval.unref();
  return interval;
}
