import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  customFetch,
  getGetDealerSettingsQueryKey,
  getSettingsRevision,
  useGetDealerSettings,
  useUpdateDealerSettings,
  type DealerSettings,
  type DealerTestDriveBooking,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { googleReviewUrl } from "@workspace/vehicle-meta";
import { customerWhatsAppNumber } from "@/lib/customer-whatsapp";
import {
  editableShowroomWeek,
  showroomWeekRows,
  showroomBookingCopy,
  type DealerSettingsGroup,
} from "@/lib/settings-simplification";
import {
  PlatformFeatureNotice,
  BookingHoursNotice,
} from "./settings-availability-notices";
import { WebsiteImageField } from "./website-image-field";
import { ColourField, isValidHsl } from "./brand/colour-field";
import { DealerWordmark } from "./brand/wordmark";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { Clock3, Trash2, Save, Check } from "./icons";
import "./settings-workspace.css";
const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const defaultTestDriveBooking: DealerTestDriveBooking = {
  enabled: true,
  durationMinutes: 30,
  bufferMinutes: 0,
  minimumNoticeHours: 0,
  dailyCapacity: 16,
  daysAhead: 30,
  blockedDates: [],
  weeklyHours: weekdayNames.map((_, day) => ({
    day,
    enabled: day !== 0,
    open: "10:00",
    close: "18:00",
  })),
  instructions: "",
  confirmationMode: "instant",
};
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function bookingErrors(booking: DealerTestDriveBooking) {
  const errors: Record<string, string> = {};
  if (!booking.enabled) return errors;
  for (const [key, label, min, max] of [
    ["durationMinutes", "Appointment length", 15, 180],
    ["bufferMinutes", "Preparation time", 0, 120],
    ["minimumNoticeHours", "Advance notice", 0, 720],
    ["dailyCapacity", "Appointments per day", 1, 100],
    ["daysAhead", "Booking window", 1, 90],
  ] as const)
    if (
      !Number.isInteger(booking[key]) ||
      booking[key] < min ||
      booking[key] > max
    )
      errors[`testDriveBooking.${key}`] =
        `${label} must be a whole number between ${min} and ${max}.`;
  if (booking.enabled) {
    const minutes = (v: string) => {
      const [h, m] = v.split(":").map(Number);
      return h * 60 + m;
    };
    if (!booking.weeklyHours.some((day) => day.enabled))
      errors["testDriveBooking.weeklyHours"] =
        "Choose at least one available day or turn online booking off.";
    else if (
      booking.weeklyHours.some(
        (day) =>
          day.enabled &&
          (!/^([01]\d|2[0-3]):[0-5]\d$/.test(day.open) ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.close) ||
            minutes(day.close) - minutes(day.open) < booking.durationMinutes),
      )
    )
      errors["testDriveBooking.weeklyHours"] =
        "Each available day needs room for one full appointment.";
  }
  return errors;
}
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="settings-field block space-y-2">
      <span className="settings-field-label flex items-baseline justify-between gap-3 text-[13px] font-semibold">
        <span>{label}</span>
        {hint && (
          <span className="settings-field-hint text-[12px] font-normal text-primary/70">
            {hint}
          </span>
        )}
      </span>
      {children}
      {error && (
        <span className="settings-field-error block text-[12px] font-semibold text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

function TestDriveSettings({
  value,
  onChange,
  errors,
  showroomHours,
}: {
  value: DealerTestDriveBooking;
  onChange: (value: DealerTestDriveBooking) => void;
  errors: Record<string, string>;
  showroomHours: DealerSettings["hours"];
}) {
  const [copyPreview, setCopyPreview] = useState(false);
  const bookingCopy = showroomBookingCopy(showroomHours, value);
  const needsHours =
    value.enabled && !value.weeklyHours.some((day) => day.enabled);
  const [blockedDate, setBlockedDate] = useState("");
  const update = <K extends keyof DealerTestDriveBooking>(
    key: K,
    next: DealerTestDriveBooking[K],
  ) => onChange({ ...value, [key]: next });
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/London",
    }).format(new Date(`${date}T12:00:00Z`));
  const hoursCopy = (
    <div className="settings-hours-copy mb-4 rounded-md border border-border bg-background p-3">
      <Button
        type="button"
        variant="outline"
        disabled={!bookingCopy}
        onClick={() => setCopyPreview(!copyPreview)}
      >
        Use showroom hours…
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        {bookingCopy
          ? "Preview your showroom timetable before applying it to appointments."
          : "Confirm all seven showroom days first, or choose appointment days below."}
      </p>
      {copyPreview && bookingCopy && (
        <div
          className="mt-3 border-t border-border pt-3"
          data-testid="booking-hours-copy-preview"
        >
          <p className="font-semibold">Proposed appointment hours</p>
          <ul className="my-3 text-sm">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
              const proposed = bookingCopy.find((item) => item.day === day)!;
              return (
                <li key={day}>
                  {weekdayNames[day]}:{" "}
                  {proposed.enabled
                    ? `${proposed.open}–${proposed.close}`
                    : "Closed"}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                update("weeklyHours", bookingCopy);
                setCopyPreview(false);
              }}
            >
              Apply these hours to draft
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCopyPreview(false)}
            >
              Keep current hours
            </Button>
          </div>
        </div>
      )}
    </div>
  );
  return (
    <div
      className="settings-subsection settings-booking-settings rounded-md border border-border p-4 sm:p-6"
      data-testid="test-drive-settings"
    >
      <div className="border-b border-border pb-5">
        <p className="text-sm text-muted-foreground">
          All appointment times use UK time.
        </p>
        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            className="h-5 w-5 accent-primary"
            checked={value.enabled}
            onChange={(event) => update("enabled", event.target.checked)}
            data-testid="checkbox-test-drive-enabled"
          />
          Accept online test-drive bookings
        </label>
        <PlatformFeatureNotice feature="testDriveBookings" />
      </div>
      {needsHours && (
        <aside
          role={errors["testDriveBooking.weeklyHours"] ? "alert" : "status"}
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          data-testid="booking-hours-required"
        >
          <p className="font-semibold">No appointment hours are set</p>
          <p className="mb-3 mt-1">
            Choose at least one available day before saving online booking.
          </p>
          {hoursCopy}
          <Button
            type="button"
            variant="link"
            className="px-0"
            onClick={() => {
              const target = document.getElementById(
                "settings-appointment-hours",
              );
              target?.focus();
              target?.scrollIntoView({ block: "start" });
            }}
          >
            Choose appointment days
          </Button>
        </aside>
      )}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Booking confirmation" hint="What the customer sees">
          <NativeSelect
            value={value.confirmationMode}
            onChange={(event) =>
              update(
                "confirmationMode",
                event.target
                  .value as DealerTestDriveBooking["confirmationMode"],
              )
            }
            data-testid="select-test-drive-confirmation"
          >
            <option value="instant">Confirm immediately</option>
            <option value="approval">Require staff approval</option>
          </NativeSelect>
        </Field>
        <p className="self-center text-sm leading-6 text-muted-foreground">
          {value.confirmationMode === "approval"
            ? "Customers receive a request acknowledgement. Review requests in the Test drives tab to confirm or decline the appointment."
            : "Available appointments are confirmed as soon as the customer completes their booking."}
        </p>
      </div>
      <details
        className="mt-5 rounded-md border border-border p-4"
        open={
          Object.keys(errors).some((key) =>
            /^testDriveBooking\.(durationMinutes|bufferMinutes|minimumNoticeHours|dailyCapacity|daysAhead)$/.test(
              key,
            ),
          ) || undefined
        }
      >
        <summary className="cursor-pointer text-sm font-semibold">
          Appointment length, notice and daily limits
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Currently {value.durationMinutes}-minute visits,{" "}
          {value.minimumNoticeHours} hours’ notice and up to{" "}
          {value.dailyCapacity} appointments a day.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {(
            [
              [
                "durationMinutes",
                "Appointment length (minutes)",
                "15–180 minutes",
                15,
                180,
              ],
              [
                "bufferMinutes",
                "Preparation time between visits (minutes)",
                "0–120 minutes",
                0,
                120,
              ],
              [
                "minimumNoticeHours",
                "Minimum advance notice (hours)",
                "0 allows same-day bookings",
                0,
                720,
              ],
              [
                "dailyCapacity",
                "Maximum appointments per day",
                "Across all vehicles",
                1,
                100,
              ],
              [
                "daysAhead",
                "Allow bookings up to (days ahead)",
                "1–90 days",
                1,
                90,
              ],
            ] as const
          ).map(([key, label, hint, min, max]) => (
            <Field
              key={key}
              label={label}
              hint={hint}
              error={errors[`testDriveBooking.${key}`]}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                value={value[key]}
                onChange={(event) => update(key, Number(event.target.value))}
                data-testid={`input-test-drive-${key}`}
              />
            </Field>
          ))}
        </div>
      </details>
      <fieldset
        id="settings-appointment-hours"
        tabIndex={-1}
        className="mt-6 scroll-mt-24 border-t border-border pt-5"
      >
        <legend className="pr-3 text-sm font-semibold">
          Appointment hours
        </legend>
        <p className="mb-3 text-sm text-muted-foreground">
          These times control the booking calendar. Your public opening hours
          are managed in Dealership details. Appointment hours can be different.
        </p>
        <BookingHoursNotice hours={showroomHours} booking={value} />
        {!needsHours && hoursCopy}
        <div className="divide-y divide-border">
          {[1, 2, 3, 4, 5, 6, 0].map((dayNumber) => {
            const day = value.weeklyHours.find(
              (entry) => entry.day === dayNumber,
            )!;
            const editDay = (change: Partial<typeof day>) =>
              update(
                "weeklyHours",
                value.weeklyHours.map((entry) =>
                  entry.day === dayNumber ? { ...entry, ...change } : entry,
                ),
              );
            return (
              <div
                key={dayNumber}
                className="grid grid-cols-2 items-center gap-3 py-3 sm:grid-cols-[minmax(140px,1fr)_1fr_1fr]"
              >
                <label className="col-span-2 flex min-h-11 items-center gap-3 text-sm font-medium sm:col-span-1">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-primary"
                    checked={day.enabled}
                    onChange={(event) =>
                      editDay({ enabled: event.target.checked })
                    }
                    aria-label={`${weekdayNames[dayNumber]} appointments`}
                  />
                  {weekdayNames[dayNumber]}
                </label>
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  From
                  <Input
                    type="time"
                    value={day.open}
                    disabled={!day.enabled}
                    aria-label={`${weekdayNames[dayNumber]} first appointment`}
                    className="min-w-0"
                    onChange={(event) => editDay({ open: event.target.value })}
                  />
                </label>
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  Until
                  <Input
                    type="time"
                    value={day.close}
                    disabled={!day.enabled}
                    aria-label={`${weekdayNames[dayNumber]} appointments finish`}
                    className="min-w-0"
                    onChange={(event) => editDay({ close: event.target.value })}
                  />
                </label>
              </div>
            );
          })}
        </div>
        {errors["testDriveBooking.weeklyHours"] && !needsHours && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {errors["testDriveBooking.weeklyHours"]}
          </p>
        )}
      </fieldset>
      <div className="mt-6 border-t border-border pt-5">
        <h4 className="text-sm font-semibold">Unavailable dates</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Close bookings for holidays, events or days when the team is
          unavailable.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Date to block">
            <Input
              type="date"
              value={blockedDate}
              onChange={(event) => setBlockedDate(event.target.value)}
              data-testid="input-test-drive-blocked-date"
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            disabled={
              !blockedDate ||
              value.blockedDates.includes(blockedDate) ||
              value.blockedDates.length >= 366
            }
            onClick={() => {
              update(
                "blockedDates",
                [...value.blockedDates, blockedDate].sort(),
              );
              setBlockedDate("");
            }}
          >
            Add unavailable date
          </Button>
        </div>
        {value.blockedDates.length > 0 && (
          <ul className="mt-3 divide-y divide-border">
            {value.blockedDates.map((date) => (
              <li
                key={date}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span>{dateLabel(date)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove unavailable date ${dateLabel(date)}`}
                  onClick={() =>
                    update(
                      "blockedDates",
                      value.blockedDates.filter((entry) => entry !== date),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-6 border-t border-border pt-5">
        <Field
          label="What to bring and booking instructions"
          hint="Shown after booking"
        >
          <Textarea
            rows={4}
            maxLength={2000}
            value={value.instructions}
            onChange={(event) => update("instructions", event.target.value)}
            placeholder="Add your dealership’s requirements and practical instructions for a test drive."
            data-testid="textarea-test-drive-instructions"
          />
        </Field>
      </div>
    </div>
  );
}

function ShowroomHoursEditor({
  value,
  onChange,
  error,
}: {
  value: DealerSettings["hours"];
  onChange: (hours: DealerSettings["hours"]) => void;
  error?: string;
}) {
  const week = editableShowroomWeek(value);
  const [timeError, setTimeError] = useState("");
  if (!week)
    return (
      <fieldset className="admin-card">
        <legend>Showroom opening hours</legend>
        <p className="text-sm text-muted-foreground">
          Your existing timetable is kept as entered.
        </p>
        {value.map((row, index) => (
          <div key={index} className="grid gap-3 py-2 sm:grid-cols-2">
            <Input
              aria-label={`Days for opening hours ${index + 1}`}
              value={row.days}
              onChange={(e) =>
                onChange(
                  value.map((entry, i) =>
                    i === index ? { ...entry, days: e.target.value } : entry,
                  ),
                )
              }
            />
            <Input
              aria-label={`Times for opening hours ${index + 1}`}
              value={row.times}
              onChange={(e) =>
                onChange(
                  value.map((entry, i) =>
                    i === index ? { ...entry, times: e.target.value } : entry,
                  ),
                )
              }
            />
          </div>
        ))}
      </fieldset>
    );
  return (
    <fieldset className="settings-subsection settings-opening-hours mt-6">
      <legend className="px-2 text-base font-semibold">
        Showroom opening hours
      </legend>
      <p className="mb-4 text-sm text-muted-foreground">
        UK time. Unknown stays unconfirmed, never closed. Editing the timetable
        updates your draft; booking hours are separate.
      </p>
      <div className="divide-y divide-border">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const entry = week.find((item) => item.day === day)!;
          const edit = (patch: Partial<typeof entry>) =>
            onChange(
              showroomWeekRows(
                week.map((item) =>
                  item.day === day ? { ...item, ...patch } : item,
                ),
              ),
            );
          return (
            <div key={day} className="settings-hours-day">
              <span className="text-sm font-medium">{weekdayNames[day]}</span>
              <NativeSelect
                value={entry.state}
                aria-label={`${weekdayNames[day]} opening status`}
                onChange={(event) =>
                  edit({ state: event.target.value as typeof entry.state })
                }
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="unknown">Unknown</option>
              </NativeSelect>
              {entry.state === "open" ? (
                <>
                  <Input
                    type="time"
                    value={entry.open}
                    aria-label={`${weekdayNames[day]} opens`}
                    onChange={(event) => {
                      if (
                        event.target.value &&
                        event.target.value < entry.close
                      ) {
                        setTimeError("");
                        edit({ open: event.target.value });
                      } else
                        setTimeError(
                          `${weekdayNames[day]} opening time must be before closing. Your saved draft time is unchanged.`,
                        );
                    }}
                  />
                  <Input
                    type="time"
                    value={entry.close}
                    aria-label={`${weekdayNames[day]} closes`}
                    onChange={(event) => {
                      if (
                        event.target.value &&
                        event.target.value > entry.open
                      ) {
                        setTimeError("");
                        edit({ close: event.target.value });
                      } else
                        setTimeError(
                          `${weekdayNames[day]} closing time must be after opening. Your saved draft time is unchanged.`,
                        );
                    }}
                  />
                </>
              ) : (
                <span className="settings-hours-state text-xs text-muted-foreground">
                  {entry.state === "closed"
                    ? "Closed all day"
                    : "Not yet confirmed"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        For each open day, closing must be after opening. Adjust the later time
        first when moving both times past the current closing time.
      </p>
      {(error || timeError) && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error || timeError}
        </p>
      )}
    </fieldset>
  );
}

/** Small owner editor. Each area saves only its own fields against the latest publication. */
export function DealerSettingsPanel({
  group = "dealership",
}: {
  group?: DealerSettingsGroup;
  allowReviewImport?: boolean;
}) {
  const query = useGetDealerSettings({
      query: { queryKey: getGetDealerSettingsQueryKey() },
    }),
    cache = useQueryClient();
  const [form, setForm] = useState<DealerSettings | null>(null),
    [baseline, setBaseline] = useState<DealerSettings | null>(null),
    [revision, setRevision] = useState<number | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState(false),
    [uploads, setUploads] = useState(0),
    [bookingBusy, setBookingBusy] = useState(false);
  const update = useUpdateDealerSettings({
    request: {
      headers: revision === null ? {} : { "If-Match": String(revision) },
    },
  });
  const dirty = Boolean(
    form && baseline && JSON.stringify(form) !== JSON.stringify(baseline),
  );
  useEffect(() => {
    if (
      query.data &&
      !dirty &&
      !update.isPending &&
      !bookingBusy &&
      (!form ||
        revision === null ||
        (getSettingsRevision(query.data) !== null &&
          getSettingsRevision(query.data)! >= revision))
    ) {
      setForm(copy(query.data));
      setBaseline(copy(query.data));
      setRevision(getSettingsRevision(query.data));
    }
  }, [query.data, query.dataUpdatedAt, dirty, update.isPending, bookingBusy]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    setReview(false);
    setError("");
    setNotice("");
  }, [group]);
  function field<K extends keyof DealerSettings>(
    key: K,
    value: DealerSettings[K],
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setReview(false);
    setNotice("");
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !form ||
      !baseline ||
      revision === null ||
      !dirty ||
      uploads ||
      update.isPending ||
      bookingBusy
    )
      return;
    setError("");
    setNotice("");
    // The hex editor deliberately keeps an invalid draft local instead of
    // replacing the last valid HSL value. Do not publish that older value while
    // an invalid colour is still visible in the form.
    if (
      group === "website" &&
      (event.currentTarget as HTMLFormElement).querySelector(
        '[aria-invalid="true"]',
      )
    ) {
      setError("Check the highlighted brand colour before publishing.");
      return;
    }
    const errors =
      group === "bookings"
        ? bookingErrors(form.testDriveBooking ?? defaultTestDriveBooking)
        : {};
    if (group === "dealership") {
      if (!form.identity.name.trim()) errors.name = "Add the dealership name.";
      if (
        form.contact.email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact.email)
      )
        errors.email = "Enter a valid public email.";
      if (
        form.contact.whatsapp &&
        !customerWhatsAppNumber(form.contact.whatsapp)
      )
        errors.phone = "Enter a valid WhatsApp number with country code.";
      if (
        form.contact.googleReviewUrl &&
        !googleReviewUrl(form.contact.googleReviewUrl)
      )
        errors.review =
          "Enter the Google review link from your Business Profile.";
    }
    if (
      group === "website" &&
      (!isValidHsl(form.identity.brandColors.primaryHsl) ||
        !isValidHsl(form.identity.brandColors.accentHsl))
    )
      errors.colour = "Choose valid brand colours.";
    if (Object.keys(errors).length) {
      setError(Object.values(errors).join(" "));
      return;
    }
    if (group === "website" && !review) {
      setReview(true);
      return;
    }
    if (group === "bookings") {
      setBookingBusy(true);
      try {
        const result = await customFetch<{
          testDriveBooking: DealerTestDriveBooking;
          revision: number;
        }>("/api/dealer-settings/bookings", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(revision),
          },
          body: JSON.stringify({
            testDriveBooking: form.testDriveBooking ?? defaultTestDriveBooking,
          }),
        });
        const saved = {
          ...copy(baseline),
          testDriveBooking: copy(result.testDriveBooking),
        };
        setForm(saved);
        setBaseline(copy(saved));
        setRevision(result.revision);
        setNotice("Booking settings saved.");
        // Refresh the HTTP revision metadata without replacing a successful save with stale cached data.
        const refreshed = await query.refetch();
        if (refreshed.isError)
          setError(
            "Bookings were saved, but the latest settings could not be refreshed. Reload before editing other settings.",
          );
      } catch (cause) {
        setError(
          cause &&
            typeof cause === "object" &&
            "status" in cause &&
            cause.status === 409
            ? "Settings changed elsewhere. Your edits are kept. Reload saved settings before trying again."
            : "Bookings could not be saved. Your edits are kept. Try again.",
        );
      } finally {
        setBookingBusy(false);
      }
      return;
    }
    // Never publish unpublished fields from another area. Server retains optimistic version checks.
    const data = copy(baseline);
    if (group === "website") {
      data.identity = {
        ...data.identity,
        logoText: form.identity.logoText,
        logoAsset: form.identity.logoAsset,
        brandColors: copy(form.identity.brandColors),
      };
      data.presentation = {
        ...data.presentation,
        heroImageUrl: form.presentation?.heroImageUrl ?? "",
        heroImageAlt: form.presentation?.heroImageAlt ?? "",
        heroImagePosition: form.presentation?.heroImagePosition ?? "center",
      };
    } else {
      data.identity = { ...data.identity, name: form.identity.name };
      data.contact = copy(form.contact);
      data.address = copy(form.address);
      data.hours = copy(form.hours);
      data.legal = copy(form.legal);
    }
    update.mutate(
      { data },
      {
        onSuccess: (saved) => {
          setForm(copy(saved));
          setBaseline(copy(saved));
          setRevision(getSettingsRevision(saved));
          cache.setQueryData(getGetDealerSettingsQueryKey(), saved);
          void cache.invalidateQueries({
            queryKey: getGetDealerSettingsQueryKey(),
          });
          setReview(false);
          setNotice(
            group === "website"
              ? "Website brand published."
              : "Dealership details saved.",
          );
        },
        onError: (cause) => {
          setError(
            cause &&
              typeof cause === "object" &&
              "status" in cause &&
              cause.status === 409
              ? "Settings changed elsewhere. Reload saved settings, then apply your changes again. Your edits are kept."
              : "Settings could not be saved. Your edits are kept. Try again.",
          );
        },
      },
    );
  }
  if (query.isLoading || !form)
    return (
      <div className="admin-card">
        {query.isError ? (
          <>
            <p role="alert">Settings could not be loaded.</p>
            <Button onClick={() => void query.refetch()}>Try again</Button>
          </>
        ) : (
          <p role="status">Loading settings…</p>
        )}
      </div>
    );
  const booking = form.testDriveBooking ?? defaultTestDriveBooking;
  const nested = <K extends "contact" | "address" | "legal">(
    key: K,
    name: keyof DealerSettings[K],
    value: string,
  ) => field(key, { ...form[key], [name]: value });
  return (
    <section className="dealer-settings-panel" data-settings-dirty={dirty}>
      <form onSubmit={save} noValidate>
        <fieldset
          disabled={update.isPending || bookingBusy || uploads > 0}
          className="space-y-5"
        >
          {group === "dealership" && (
            <>
              <section className="admin-card space-y-5">
                <h3>Business and contact details</h3>
                <p className="text-sm text-muted-foreground">
                  Used throughout your website, messages and new documents.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Dealership name">
                    <Input
                      value={form.identity.name}
                      onChange={(e) =>
                        field("identity", {
                          ...form.identity,
                          name: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Public phone">
                    <Input
                      type="tel"
                      value={form.contact.phone}
                      onChange={(e) =>
                        nested("contact", "phone", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="WhatsApp number">
                    <Input
                      type="tel"
                      value={form.contact.whatsapp}
                      onChange={(e) =>
                        nested("contact", "whatsapp", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Public email">
                    <Input
                      type="email"
                      value={form.contact.email}
                      onChange={(e) =>
                        nested("contact", "email", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Street address">
                    <Input
                      value={form.address.street}
                      onChange={(e) =>
                        nested("address", "street", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Town or city">
                    <Input
                      value={form.address.city}
                      onChange={(e) =>
                        nested("address", "city", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Postcode">
                    <Input
                      value={form.address.postcode}
                      onChange={(e) =>
                        nested("address", "postcode", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Google Maps link">
                    <Input
                      type="url"
                      value={form.address.mapsUrl}
                      onChange={(e) =>
                        nested("address", "mapsUrl", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Google review link">
                    <Input
                      type="url"
                      value={form.contact.googleReviewUrl ?? ""}
                      onChange={(e) =>
                        nested("contact", "googleReviewUrl", e.target.value)
                      }
                    />
                  </Field>
                </div>
                <ShowroomHoursEditor
                  value={form.hours}
                  onChange={(value) => field("hours", value)}
                />
              </section>
              <section className="admin-card space-y-4">
                <h3>Company details</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["companyName", "Registered company name"],
                      ["companyNumber", "Company number"],
                      ["vatNumber", "VAT number"],
                      ["termsUrl", "Terms link"],
                      ["privacyUrl", "Privacy link"],
                      ["cookieUrl", "Cookie policy link"],
                    ] as const
                  ).map(([name, label]) => (
                    <Field key={name} label={label}>
                      <Input
                        value={form.legal[name]}
                        onChange={(e) => nested("legal", name, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              </section>
            </>
          )}
          {group === "website" && (
            <section className="admin-card space-y-5">
              <h3>Website brand</h3>
              <p className="text-sm text-muted-foreground">
                One dealership brand for your website, messages and new
                documents.
              </p>
              <DealerWordmark {...form.identity} />
              <WebsiteImageField
                label="Dealership logo"
                value={form.identity.logoAsset}
                onChange={(value) =>
                  field("identity", { ...form.identity, logoAsset: value })
                }
                onBusyChange={(busy) =>
                  setUploads((n) => Math.max(0, n + (busy ? 1 : -1)))
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <ColourField
                  testId="brand-main"
                  label="Main colour"
                  value={form.identity.brandColors.primaryHsl}
                  onChange={(value) =>
                    field("identity", {
                      ...form.identity,
                      brandColors: {
                        ...form.identity.brandColors,
                        primaryHsl: value,
                      },
                    })
                  }
                />
                <ColourField
                  testId="brand-accent"
                  label="Accent colour"
                  value={form.identity.brandColors.accentHsl}
                  onChange={(value) =>
                    field("identity", {
                      ...form.identity,
                      brandColors: {
                        ...form.identity.brandColors,
                        accentHsl: value,
                      },
                    })
                  }
                />
              </div>
              <WebsiteImageField
                label="Homepage photograph"
                kind="photo"
                value={form.presentation?.heroImageUrl ?? ""}
                onChange={(value) =>
                  field("presentation", {
                    ...form.presentation,
                    heroImageUrl: value,
                  })
                }
                onBusyChange={(busy) =>
                  setUploads((n) => Math.max(0, n + (busy ? 1 : -1)))
                }
              />
              <Field label="Photograph description">
                <Input
                  value={form.presentation?.heroImageAlt ?? ""}
                  onChange={(e) =>
                    field("presentation", {
                      ...form.presentation,
                      heroImageAlt: e.target.value,
                    })
                  }
                />
              </Field>
              {form.presentation?.heroImageUrl && (
                <img
                  src={form.presentation.heroImageUrl}
                  alt={form.presentation.heroImageAlt ?? ""}
                  className="max-h-64 w-full rounded-md object-cover"
                />
              )}
              {review && (
                <div
                  className="rounded-md border border-border p-4"
                  role="status"
                >
                  <h4 className="font-semibold">Ready to publish</h4>
                  <p>
                    Your logo, colours and homepage photograph will be used on
                    the website. Existing invoices and payments stay unchanged.
                  </p>
                </div>
              )}
            </section>
          )}
          {group === "bookings" && (
            <section className="admin-card">
              <h3 className="mb-4">Test-drive booking</h3>
              <TestDriveSettings
                value={booking}
                onChange={(value) => field("testDriveBooking", value)}
                errors={{}}
                showroomHours={form.hours}
              />
            </section>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-[#1b6543]"
            >
              <Check size={16} />
              {notice}
            </p>
          )}
          <div className="settings-save-bar flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {dirty ? "Unsaved changes." : "Saved."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={update.isPending}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm("Discard these unsaved settings?")
                  ) {
                    setForm(copy(query.data!));
                    setBaseline(copy(query.data!));
                    setRevision(getSettingsRevision(query.data!));
                    setError("");
                    setReview(false);
                  }
                }}
              >
                Discard changes
              </Button>
              <Button
                type="submit"
                disabled={
                  !dirty || update.isPending || bookingBusy || uploads > 0
                }
              >
                <Save size={16} />
                {update.isPending || bookingBusy
                  ? "Saving…"
                  : group === "bookings"
                    ? "Save bookings"
                    : group === "website"
                      ? review
                        ? "Publish brand"
                        : "Review brand"
                      : "Save details"}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
