/** Existing editable-copy contract, unchanged. Staff edit plain text, never HTML. */
export type EmailTemplate = {
  id: string;
  label: string;
  category:
    "Enquiries" | "Bookings" | "Reservations" | "Sales" | "Customer access";
  subject: string;
  body: string;
  headline?: string;
};
/** Existing appearance contract, unchanged. Empty strings mean absent/fallback. */
export type EmailAppearance = {
  logoUrl: string;
  brandColour: string;
  heading: string;
  footer: string;
};
export const VARIABLES = [
  "dealer_name",
  "dealer_email",
  "dealer_phone",
  "dealer_address",
  "customer_name",
  "customer_email",
  "vehicle_title",
  "vehicle_registration",
  "appointment_time",
  "appointment_status",
  "duration",
  "visit_instructions",
  "parking_instructions",
  "manage_url",
  "message",
  "preferred_contact",
  "document_number",
  "document_type",
  "amount",
  "amount_received",
  "balance",
  "payment_status",
  "reservation_status",
  "portal_url",
  "expires_at",
] as const;
export type CopyVariable = (typeof VARIABLES)[number];
export type CopyVariables = Partial<Record<CopyVariable, string>> & {
  dealer_name: string;
};
export type TemplateId =
  | "invoice_copy"
  | "vehicle_details"
  | "service_history"
  | "pre_accident_photos"
  | "appointment_details"
  | "enquiry_message"
  | "enquiry_acknowledgement"
  | "dealer_notification"
  | "callback"
  | "booking_request"
  | "booking_confirmation"
  | "booking_change"
  | "booking_cancellation"
  | "booking_reminder"
  | "reservation_confirmation"
  | "reservation_payment"
  | "reservation_refund"
  | "invoice"
  | "payment_receipt"
  | "balance_statement"
  | "document_email"
  | "customer_access_link";

// NEW integration inputs below. These are not claims about existing backend fields.
export type AttachmentKind =
  | "invoice"
  | "service-history"
  | "pre-accident"
  | "receipt"
  | "statement"
  | "document"
  | "other";
export type AttachmentMetadata = {
  fileName: string;
  kind: AttachmentKind;
  /** True only after the caller verifies this file is included in outgoing MIME attachments. */
  confirmed: boolean;
};
export type EmailAction = { label: string; url: string };
/** Optional preformatted parts for the approved two-column appointment layout. */
export type AppointmentDisplay = {
  date: string;
  time: string;
  day?: string;
  year?: string;
  timezone?: string;
};
export type IntegrationContext = {
  /** Guards appointment wording. Does not create or update a booking. */
  appointment?: {
    state: "pending" | "confirmed" | "changed" | "cancelled";
    address?: string;
    previousTime?: string;
    display?: AppointmentDisplay;
  };
  /** Confirm an existing official document before using issued-document wording. */
  document?: { state: "issued"; issuedAt?: string };
  financial?: {
    balanceState?: "paid" | "partially-paid" | "outstanding" | "unknown";
    paymentState?: "confirmed" | "pending" | "failed" | "unknown";
    refundState?: "completed" | "pending" | "failed" | "unknown";
    /** Supplied snapshot timestamp, already formatted by the application. */
    asOf?: string;
  };
  attachments?: readonly AttachmentMetadata[];
  /** Optional exact bearer tokens for unusual URL shapes; used only for leak rejection, never rendered. */
  privateTokenValues?: readonly string[];
  primaryAction?: EmailAction;
  secondaryActions?: readonly EmailAction[];
};
export type RenderEmailInput = {
  template: EmailTemplate;
  variables: CopyVariables;
  appearance?: Partial<EmailAppearance>;
  context?: IntegrationContext;
};
export type RenderedEmail = {
  templateId: TemplateId;
  subject: string;
  html: string;
  text: string;
  /** UTF-8 sizes before MIME encoding. */
  sizes: { htmlBytes: number; textBytes: number; subjectBytes: number };
  warnings: string[];
};
