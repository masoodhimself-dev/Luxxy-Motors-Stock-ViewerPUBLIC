/** Explicit, staff-only capture: saving a lead does not authorise outbound mail. */
export function quickEnquiryCapture(header: string | undefined, staff: boolean, input: {
  type: string; appointmentAt?: unknown; adHocVehicle?: unknown; followUpAt?: unknown;
  followUpNote?: unknown; allowOutsideHours?: boolean; allowDoubleBooking?: boolean;
}) {
  if (!header) return { quick: false, error: null };
  if (!staff || header !== 'quick') return { quick: false, error: 'Quick capture is available only for staff enquiries.' };
  if (input.type !== 'general' || input.appointmentAt || input.adHocVehicle || input.followUpAt || input.followUpNote || input.allowOutsideHours || input.allowDoubleBooking) {
    return { quick: false, error: 'Use the full enquiry or booking form to arrange appointments and follow-ups.' };
  }
  return { quick: true, error: null };
}
