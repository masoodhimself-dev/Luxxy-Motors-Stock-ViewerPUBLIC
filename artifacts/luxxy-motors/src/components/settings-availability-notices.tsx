import type { DealerSettings, DealerTestDriveBooking } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useDealerFeatures, type DealerFeatureKey } from '@/lib/dealer-features';
import { editableShowroomWeek, settingsWeekdays } from '@/lib/settings-simplification';

const featureNames: Record<DealerFeatureKey, string> = {
  testDriveBookings: 'Online test-drive booking',
  testDriveDeclarations: 'Test-drive declarations',
  partExchange: 'Website part-exchange requests',
  publicEnquiries: 'Website enquiries',
  customerEmails: 'Customer email sending',
  staffAiDrafts: 'AI reply drafts',
};

/** Availability is read-only here; publishing website settings cannot change it. */
export function PlatformFeatureNotice({ feature }: { feature: DealerFeatureKey }) {
  const query = useDealerFeatures();
  const label = featureNames[feature];
  const available = query.data?.features?.[feature];
  if (query.isLoading) return <p role="status" className="mt-3 text-sm text-muted-foreground">Checking {label.toLowerCase()} availability…</p>;
  if (query.isError || typeof available !== 'boolean') return <aside role="status" aria-label={`${label} availability`} className="mt-3 rounded-md border border-border bg-secondary/30 p-3 text-sm">
    <p>{label} availability could not be confirmed. Your saved settings are unchanged.</p>
    <Button type="button" variant="outline" className="mt-2" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry availability check</Button>
  </aside>;
  if (available) return null;
  return <aside role="status" aria-label={`${label} availability`} className="mt-3 rounded-md border border-accent/40 bg-secondary/30 p-3 text-sm">
    <p><strong>{label} is currently unavailable for this dealership.</strong></p>
    <p className="mt-1">Changing or publishing settings here does not enable this feature. Ask the platform operator to check availability. Existing records are kept.</p>
  </aside>;
}

/** Compare confirmed intervals only. Never infer closure from missing/custom hours. */
export function bookingHoursWarnings(hours: DealerSettings['hours'], booking?: DealerTestDriveBooking): string[] {
  if (!booking?.enabled) return [];
  const appointments = booking.weeklyHours.filter(day => day.enabled && /^([01]\d|2[0-3]):[0-5]\d$/.test(day.open) && /^([01]\d|2[0-3]):[0-5]\d$/.test(day.close) && day.open < day.close);
  if (!appointments.length) return [];
  const week = editableShowroomWeek(hours);
  if (!week) return ['Your showroom hours use a custom format, so they cannot be compared automatically. Check that the appointment timetable suits your visiting arrangements.'];
  const warnings: string[] = [];
  for (const appointment of appointments) {
    const showroom = week.find(day => day.day === appointment.day);
    if (!showroom || showroom.state === 'unknown') warnings.push(`${settingsWeekdays[appointment.day]}: appointments are set for ${appointment.open}–${appointment.close}, but showroom opening hours are unconfirmed.`);
    else if (showroom.state === 'closed') warnings.push(`${settingsWeekdays[appointment.day]}: appointments are set for ${appointment.open}–${appointment.close}, while the showroom is shown as closed.`);
    else if (appointment.open < showroom.open || appointment.close > showroom.close) warnings.push(`${settingsWeekdays[appointment.day]}: appointments are set for ${appointment.open}–${appointment.close}, outside the showroom hours of ${showroom.open}–${showroom.close}.`);
  }
  return warnings;
}

export function BookingHoursNotice({ hours, booking }: { hours: DealerSettings['hours']; booking?: DealerTestDriveBooking }) {
  const warnings = bookingHoursWarnings(hours, booking);
  if (!warnings.length) return null;
  return <aside role="status" aria-label="Showroom and appointment hours" className="mt-3 rounded-md border border-accent/40 bg-secondary/30 p-3 text-sm">
    <strong>Check showroom and appointment hours</strong>
    <ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
    <p className="mt-2">These settings are independent and may intentionally differ. Review both timetables if needed; nothing is changed automatically.</p>
  </aside>;
}
