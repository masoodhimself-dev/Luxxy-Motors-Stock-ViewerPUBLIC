import { UpdateDealerSettingsBody } from "../../../../lib/api-zod/src/generated/api";
import { bookingPolicyError, defaultBookingPolicy } from "./booking-slots";
import { SettingsVersionError } from "./settings-versions";
export function bookingSettingsUpdate(
  input: unknown,
  current: Record<string, unknown>,
): Record<string, any> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("testDriveBooking" in input)
  )
    throw new SettingsVersionError("Submit booking settings only.", 400);
  const value = (input as { testDriveBooking: unknown }).testDriveBooking;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean"
  )
    throw new SettingsVersionError(
      "Choose whether test-drive bookings are enabled.",
      400,
    );
  const previous =
    current.testDriveBooking &&
    typeof current.testDriveBooking === "object" &&
    !Array.isArray(current.testDriveBooking)
      ? current.testDriveBooking
      : defaultBookingPolicy;
  // Switching off must always work, even if old opening hours or unrelated website copy need correcting.
  if (!value.enabled)
    return { ...current, testDriveBooking: { ...previous, enabled: false } };
  const parsed = UpdateDealerSettingsBody.shape.testDriveBooking.safeParse({
    ...defaultBookingPolicy,
    ...previous,
    ...value,
  });
  if (!parsed.success || !parsed.data)
    throw new SettingsVersionError(
      "Check the test-drive booking settings.",
      400,
    );
  const error = bookingPolicyError(parsed.data);
  if (error) throw new SettingsVersionError(error, 400);
  return { ...current, testDriveBooking: parsed.data };
}
