import { useEffect, useState } from "react";
import {
  useGetEnquiryAvailability,
  useGetStaffAppointmentAvailability,
  getGetEnquiryAvailabilityQueryKey,
  getGetStaffAppointmentAvailabilityQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { availableBookingDates, bookingDateLabel, defaultBookingSettings, londonDate } from "@/lib/test-drive-dates";
import { validStaffAppointmentDateTime } from "../../../../api-server/src/lib/booking-slots";

const field = "enquiry-field grid gap-1.5 text-sm font-medium";

export function AppointmentSlots({
  bookingId,
  initialDate,
  value,
  onChange,
  onValidityChange,
}: {
  bookingId?: string;
  initialDate?: string;
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const { settings, isLoading, isError } = useDealerSettings();
  const config = settings.testDriveBooking ?? defaultBookingSettings;
  const dates = availableBookingDates(config);
  const [date, setDate] = useState(initialDate ?? dates[0] ?? londonDate());
  const publicQuery = useGetEnquiryAvailability(
    { date },
    {
      query: {
        queryKey: getGetEnquiryAvailabilityQueryKey({ date }),
        enabled:
          !bookingId &&
          !isLoading &&
          !isError &&
          config.enabled &&
          dates.includes(date),
        refetchInterval: 30_000,
        staleTime: 0,
      },
    },
  );
  const staffQuery = useGetStaffAppointmentAvailability(
    bookingId ?? "",
    { date },
    {
      query: {
        queryKey: getGetStaffAppointmentAvailabilityQueryKey(bookingId ?? "", {
          date,
        }),
        enabled:
          Boolean(bookingId) &&
          !isLoading &&
          !isError &&
          config.enabled &&
          dates.includes(date),
        refetchInterval: 30_000,
        staleTime: 0,
      },
    },
  );
  const query = bookingId ? staffQuery : publicQuery;
  const dateIsBookable = dates.includes(date);
  // Public slots may use duration + buffer increments which the staff endpoint cannot accept.
  const now = new Date();
  const availableSlots = (query.data?.slots ?? []).filter(slot => slot.available && validStaffAppointmentDateTime(new Date(slot.startAt), now));
  const selectedStaffCompatible = Boolean(value && validStaffAppointmentDateTime(new Date(value), now));
  const selectedAvailable = availableSlots.some(slot => slot.startAt === value);
  const valid = Boolean(
    value && !isLoading && !isError && config.enabled && dateIsBookable &&
    !query.isLoading && !query.isError && query.data?.date === date &&
    selectedAvailable
  );
  useEffect(() => { onValidityChange?.(valid); }, [valid, onValidityChange]);
  useEffect(() => {
    if (
      value &&
      (!selectedStaffCompatible || (query.data && !selectedAvailable))
    )
      onChange("");
  }, [query.data, value, onChange, selectedAvailable, selectedStaffCompatible]);
  if (isLoading) return <p role="status">Loading booking hours…</p>;
  if (isError)
    return (
      <p role="alert">
        Booking settings could not be loaded. Refresh before booking.
      </p>
    );
  if (!config.enabled)
    return <p>Test-drive scheduling is switched off in Settings.</p>;
  return (
    <div className="enquiry-slots space-y-3">
      <label className={field}>
        Appointment date
        <NativeSelect
          value={date}
          disabled={!dates.length}
          onChange={(event) => {
            setDate(event.target.value);
            onChange("");
          }}
        >
          {!dates.includes(date) && <option value={date} disabled>{bookingDateLabel(date)} — unavailable</option>}
          {dates.map((day) => (
            <option key={day} value={day}>
              {bookingDateLabel(day)}
            </option>
          ))}
        </NativeSelect>
      </label>
      {!dates.length ? <p className="text-sm text-muted-foreground">No booking dates are available. Check the opening hours or try again later.</p> : !dateIsBookable && <p className="text-sm text-amber-900">This date is outside the available booking dates. Choose another date.</p>}
      <p className="text-xs text-muted-foreground">
        UK time · {config.durationMinutes} minutes
        {config.confirmationMode === "approval"
          ? " · Staff approval required after saving"
          : ""}
      </p>
      {dateIsBookable && (query.isError ? (
        <div role="alert">
          Could not load times.{" "}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
          >
            Retry times
          </Button>
        </div>
      ) : query.isLoading ? (
        <p role="status">Checking available times…</p>
      ) : (
        <div
          className="flex flex-wrap gap-2"
          aria-label="Available appointment times"
        >
          {availableSlots
            .map((slot) => (
              <Button
                key={slot.startAt}
                type="button"
                size="sm"
                variant={value === slot.startAt ? "default" : "outline"}
                aria-pressed={value === slot.startAt}
                onClick={() => onChange(slot.startAt)}
              >
                {slot.label}
              </Button>
            ))}
          {!availableSlots.length && (
            <p className="text-sm text-muted-foreground">
              No times available. Choose another date.
            </p>
          )}
        </div>
      ))}
      {value &&
        query.data &&
        !selectedAvailable && (
          <p role="alert" className="text-sm text-destructive">
            That time is no longer available. Choose another.
          </p>
        )}
    </div>
  );
}

