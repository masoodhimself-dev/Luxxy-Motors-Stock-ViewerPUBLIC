import {
  defaultEmailTemplates,
  EmailTemplateError,
  renderEmailTemplate,
  validateEmailTemplate,
  type EmailAppearance,
  type EmailFacts,
} from "@workspace/vehicle-meta";
export const sampleEmailVariables: Record<string, string> = {
  dealer_name: "Example Motors",
  dealer_email: "hello@example.test",
  dealer_phone: "07700 900123",
  dealer_address: "12 Example Road, London",
  customer_name: "Alex Taylor",
  customer_email: "alex@example.test",
  reference: "SAMPLE-001",
  vehicle_title: "2022 Volkswagen Golf 1.5 TSI",
  vehicle_registration: "AB22 CDE",
  appointment_time: "Monday 19 October 2026 at 10:30",
  appointment_status: "confirmed",
  duration: "30 minutes",
  visit_instructions: "Please bring your driving licence.",
  parking_instructions: "Customer parking is beside the showroom.",
  manage_url: "https://example.test/viewing/sample",
  message:
    "Here are the details we discussed. Reply if you have any questions.",
  preferred_contact: "Phone call",
  document_number: "INV-SAMPLE",
  document_type: "Invoice",
  amount: "£100.00",
  amount_received: "£100.00",
  balance: "£12,400.00",
  payment_status: "confirmed",
  reservation_status: "reserved",
  portal_url: "https://example.test/my-purchase/sample",
  expires_at: "19 October 2026 at 18:00",
};
/** Fictional facts, with each preview showing its own actual kind of message. No email is sent. */
export function previewEmailTemplate(
  id: string,
  raw: unknown,
  savedAppearance?: EmailAppearance,
) {
  const template = defaultEmailTemplates.find((item) => item.id === id);
  if (!template) throw new EmailTemplateError("Email template not found.", 404);
  const copy = validateEmailTemplate(raw),
    variables = { ...sampleEmailVariables };
  const facts: EmailFacts = [
    { label: "Vehicle", value: variables.vehicle_title! },
    { label: "Registration", value: variables.vehicle_registration! },
  ];
  const booking =
    template.category === "Bookings" || id === "appointment_details";
  if (booking) {
    variables.appointment_status =
      id === "booking_request"
        ? "requested — awaiting confirmation"
        : id === "booking_cancellation"
          ? "cancelled"
          : "confirmed";
    facts.push(
      { label: "Appointment status", value: variables.appointment_status },
      { label: "Appointment", value: variables.appointment_time! },
      { label: "Duration", value: variables.duration! },
      { label: "Showroom", value: variables.dealer_address! },
    );
  }
  const document = template.category === "Sales" || id === "invoice_copy";
  if (document)
    facts.push(
      { label: "Document", value: `${template.label} INV-SAMPLE` },
      {
        label: "Payments recorded at issue",
        value: variables.amount_received!,
      },
      { label: "Balance at issue", value: variables.balance! },
    );
  const appearance = savedAppearance;
  const attachments = document
    ? ["INV-SAMPLE.pdf"]
    : ["service_history", "pre_accident_photos"].includes(id)
      ? ["vehicle-photo-1.jpg", "vehicle-photo-2.jpg"]
      : undefined;
  return {
    ...renderEmailTemplate(copy, variables, facts, appearance, {
      templateId: id,
      attachments,
    }),
    sample: true,
    sent: false,
  };
}
