import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  and,
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
  type Enquiry,
} from "@workspace/db";
import type { Logger } from "pino";
import { viewingCalendarIcs, viewingManageUrl } from "./enquiry-links";

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
};

const defaultDealerProfile: DealerProfile = {
  identity: { name: "Used Car Showroom" },
  contact: { email: "", phone: "", whatsapp: "", address: "" },
};

type DealerSettingsConfig = {
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
        process.env.STOCK_DEALER_ID ?? "luxxy-motors",
      ),
    );
  const config = settings?.config as DealerSettingsConfig | undefined;
  return {
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

function safeHeaderName(value: string) {
  return value.replace(/[\r\n<>]/g, "").trim().slice(0, 120) || "Used Car Showroom";
}

function vehicleLabel(enquiry: Enquiry, dealerName: string) {
  return enquiry.vehicleTitle || `your ${dealerName} enquiry`;
}

function providerError(body: string, status: number) {
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    if (parsed.message || parsed.error) {
      return String(parsed.message || parsed.error).slice(0, 300);
    }
  } catch {
    // The provider may return a non-JSON error body.
  }
  return `Email provider returned HTTP ${status}.`;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  idempotencyKey: string,
  dealerName: string,
  attachments?: Array<{ filename: string; content: string }>,
) {
  const response = await new ReplitConnectors().proxy("resend", "/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from:
        process.env.RESEND_FROM_EMAIL?.trim() ||
        `${safeHeaderName(dealerName)} <onboarding@resend.dev>`,
      to: [to],
      subject,
      html,
      ...(attachments?.length ? { attachments } : {}),
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(providerError(body, response.status));
  }
  try {
    const parsed = JSON.parse(body) as { id?: string };
    return parsed.id ?? null;
  } catch {
    return null;
  }
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

function customerEmail(
  enquiry: Enquiry,
  reminder: boolean,
  dealer: DealerProfile,
) {
  const dealerName = dealer.identity.name;
  const appointment = formatAppointment(enquiry.appointmentAt);
  const greeting = escapeHtml(enquiry.customerName);
  const vehicle = escapeHtml(vehicleLabel(enquiry, dealerName));
  const isViewing = enquiry.type === "viewing" && enquiry.appointmentAt != null;
  const intro = reminder
    ? "This is a reminder for your upcoming viewing."
    : isViewing
      ? "Your viewing has been booked."
      : "We have received your enquiry.";
  const appointmentRow = appointment
    ? `<p><strong>Viewing time:</strong> ${escapeHtml(appointment)} (${bookingTimezone})</p>`
    : "";
  const manageUrl = isViewing ? viewingManageUrl(enquiry.id) : null;
  const manageBlock = manageUrl
    ? `<p>Need to move or cancel it? <a href="${escapeHtml(manageUrl)}">Change your viewing</a>. A calendar invite is attached to this email.</p>`
    : "<p>If you need to make a change, please reply to this email or contact the showroom.</p>";
  const contactLine = [
    dealer.contact.phone ? `call ${dealer.contact.phone}` : null,
    dealer.contact.whatsapp ? `WhatsApp ${dealer.contact.whatsapp}` : null,
  ]
    .filter((entry): entry is string => entry != null)
    .join(" or ");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
       <h1 style="color:#172033">${reminder ? "Viewing reminder" : `${escapeHtml(dealerName)} enquiry confirmation`}</h1>
      <p>Hi ${greeting},</p>
      <p>${intro}</p>
      <p><strong>Your reference:</strong> ${escapeHtml(enquiry.reference)}</p>
      <p><strong>Vehicle:</strong> ${vehicle}</p>
      ${appointmentRow}
      ${manageBlock}
      ${contactLine ? `<p>Quote your reference when you ${escapeHtml(contactLine)}.</p>` : ""}
       <p>Thanks,<br />${escapeHtml(dealerName)}</p>
    </div>
  `;
}

function dealerEmail(enquiry: Enquiry, dealerName: string) {
  const appointment = formatAppointment(enquiry.appointmentAt);
  const appointmentRow = appointment
    ? `<p><strong>Viewing time:</strong> ${escapeHtml(appointment)} (${bookingTimezone})</p>`
    : "";

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
       <h1 style="color:#172033">New ${escapeHtml(dealerName)} enquiry</h1>
      <p>A customer has submitted a new enquiry.</p>
      ${row("Reference", enquiry.reference)}
      ${row("Customer", enquiry.customerName)}
      ${row("Phone", enquiry.phone)}
      ${row("Email", enquiry.email)}
      ${row(
        "Prefers",
        enquiry.preferredContact
          ? contactMethodLabels[enquiry.preferredContact] ?? enquiry.preferredContact
          : null,
      )}
       <p><strong>Vehicle:</strong> ${escapeHtml(vehicleLabel(enquiry, dealerName))}</p>
      ${appointmentRow}
      ${partExchangeSection(enquiry)}
      <p><strong>Message:</strong><br />${escapeHtml(enquiry.message)}</p>
    </div>
  `;
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
    subject:
      claimed.type === "viewing"
          ? `Your ${dealer.identity.name} viewing is booked`
          : `Your ${dealer.identity.name} enquiry`,
    html: customerEmail(claimed, false, dealer),
    idempotencyKey: `enquiry-${claimed.id}-customer-confirmation`,
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
    to: process.env.DEALER_NOTIFICATION_EMAIL?.trim() || dealer.contact.email || null,
    subject:
      claimed.type === "viewing"
        ? `New viewing booked at ${dealer.identity.name}`
        : `New enquiry at ${dealer.identity.name}`,
    html: dealerEmail(claimed, dealer.identity.name),
    idempotencyKey: `enquiry-${claimed.id}-dealer-notification`,
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
    .where(eq(enquiriesTable.id, enquiry.id));
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
    subject: `Reminder: your upcoming ${dealer.identity.name} viewing`,
    html: customerEmail(claimed, true, dealer),
    // A rescheduled viewing gets a fresh reminder, so the key follows the time.
    idempotencyKey: `enquiry-${claimed.id}-customer-reminder-${claimed.appointmentAt?.getTime() ?? 0}`,
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
      or(
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
      ),
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
        eq(enquiriesTable.type, "viewing"),
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
        eq(enquiriesTable.type, "viewing"),
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

export function startReminderWorker(log: Logger) {
  const run = () =>
    processDueNotifications(log).catch((error) => {
      log.error({ err: error }, "Notification worker failed");
    });
  void run();
  const interval = setInterval(run, 5 * 60 * 1000);
  interval.unref();
  return interval;
}