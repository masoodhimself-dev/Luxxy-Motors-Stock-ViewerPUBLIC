import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Enquiry } from "@workspace/api-client-react";
import { Check, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { declarationRequest, type TestDriveDeclaration } from "@/lib/test-drive-declarations";
import { useStaffAccess } from "./dealer-administration";
import "./booking-readiness.css";

type DeclarationList = { declarations: TestDriveDeclaration[]; currentAppointmentRevision: number };

export function bookingNeedsPreparation(booking: Enquiry, now = Date.now()) {
  const end = Date.parse(booking.appointmentAt ?? "") + ((booking.appointmentDurationMinutes ?? 30) + 120) * 60_000;
  return Boolean(booking.appointmentAt && end > now && !booking.appointmentCancelledAt && !booking.mergedIntoId && booking.status !== "closed" && booking.attendance !== "completed" && booking.attendance !== "no_show");
}

/** Reads declaration records only; it never creates links or records staff checks. */
export function BookingReadiness({ booking, autoLoad = false }: { booking: Enquiry; autoLoad?: boolean }) {
  const [requested, setRequested] = useState(false);
  const access = useStaffAccess();
  const canRead = !access.isError && !access.isLoading && access.data?.permissions.includes("sales.manage") === true;
  const active = bookingNeedsPreparation(booking);
  const eligible = active && booking.appointmentStatus === "confirmed" && Boolean(booking.vehicleId);
  const enabled = canRead && eligible && (autoLoad || requested);
  const query = useQuery({
    queryKey: ["test-drive-declarations", booking.id],
    queryFn: async () => {
      const result = await declarationRequest<DeclarationList>(`/api/staff/enquiries/${booking.id}/test-drive-declarations`);
      if (!Array.isArray(result?.declarations) || !Number.isInteger(result.currentAppointmentRevision)) throw new Error("Preparation records unavailable");
      return result;
    },
    enabled,
    retry: false,
    staleTime: 20_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });
  if (!canRead || !active) return null;
  if (!eligible) return <p className="booking-readiness-note">{booking.appointmentStatus !== "confirmed" ? "Confirm the booking before preparing its declaration." : "Link a stock vehicle before preparing its declaration."}</p>;

  const revision = booking.appointmentRevision ?? 0;
  const staleBooking = query.data && query.data.currentAppointmentRevision !== revision;
  const matching = !query.isError && !staleBooking ? query.data?.declarations.filter(item =>
    item.current === true && item.snapshot.appointmentRevision === revision && item.snapshot.vehicleId === booking.vehicleId &&
    Date.parse(item.snapshot.appointmentAt) === Date.parse(booking.appointmentAt!) &&
    item.snapshot.durationMinutes === (booking.appointmentDurationMinutes ?? 30) &&
    (item.status === "signed" || (item.status === "pending" && Date.parse(item.expiresAt) > Date.now())),
  ) ?? [] : [];
  // A replacement link does not invalidate already-signed evidence for the same appointment.
  const record = matching.find(item => item.status === "signed" && item.signedAt) ?? matching.find(item => item.status === "pending");
  const signed = Boolean(record && record.status === "signed" && record.signedAt);
  const licence = Boolean(record && record.staffChecks.licenceChecked);
  const insurance = Boolean(record && record.staffChecks.insuranceChecked);
  const checked = signed && licence && insurance;
  const available = !query.isError && !staleBooking && Boolean(query.data);
  return <section className="booking-readiness" aria-label={`Visit preparation for ${booking.customerName}`}>
    <div className="booking-readiness-heading"><strong>{available ? checked ? "Checks recorded" : "Preparation needed" : "Visit preparation"}</strong>
      {available && <span>Signature and staff checks</span>}
    </div>
    {query.isError ? <div className="booking-readiness-state"><span>Preparation could not be checked.</span><Button type="button" size="sm" variant="ghost" onClick={() => { setRequested(true); void query.refetch(); }}>Retry checks</Button></div>
      : staleBooking ? <p>Appointment changed. Refresh the booking before checking its preparation.</p>
      : !query.data ? <div className="booking-readiness-state">{enabled ? <span role="status">Checking preparation…</span> : <><span>Signature and staff checks not loaded.</span><Button type="button" size="sm" variant="ghost" onClick={() => setRequested(true)}>Check preparation</Button></>}</div>
      : <>
        <ul aria-label="Recorded checks">{([
          [signed, signed ? "Declaration signed" : record ? "Awaiting signature" : "Declaration needed"],
          [licence, licence ? "Licence checked" : "Licence check needed"],
          [insurance, insurance ? "Insurance checked" : "Insurance check needed"],
        ] as const).map(([done, label]) => <li key={label} data-complete={done}>{done ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}{label}</li>)}</ul>
        {checked && <p>Recorded checks only. Confirm the car is ready before handing over the keys.</p>}
      </>}
  </section>;
}
