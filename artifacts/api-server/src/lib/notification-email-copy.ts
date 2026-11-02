/** A general enquiry is not a vehicle: only label a recorded car as one. */
export function notificationVehicleFacts(vehicleTitle: string | null | undefined) {
  const title = vehicleTitle?.trim();
  return title ? [{ label: 'Vehicle', value: title }] : [];
}
