import { DirectWhatsApp } from "@/components/direct-whatsapp";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  FileText,
  LoaderCircle,
  Mail,
  RefreshCw,
  SignedDeclaration,
} from "@/components/icons";
import { type Enquiry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  declarationError,
  declarationRequest,
  declarationTime,
  declarationToken,
  type TestDriveDeclaration,
} from "@/lib/test-drive-declarations";
import { requestUuid } from "@/lib/request-uuid";
import { useDealerFeatures } from "@/lib/dealer-features";
import { EnquiryEmailComposer } from "./enquiry-email-composer";
import { Chip } from "./portal-ui";
import "./test-drive-declarations.css";

const labels = {
  pending: "Awaiting signature",
  signed: "Signed",
  revoked: "Link revoked",
  expired: "Link expired",
  superseded: "Appointment changed",
};
export function TestDriveDeclarations({
  booking,
  canEmail,
  onClose,
}: {
  booking: Enquiry;
  canEmail: boolean;
  onClose: () => void;
}) {
  const base = `/api/staff/enquiries/${booking.id}/test-drive-declarations`;
  const queryKey = ["test-drive-declarations", booking.id];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      declarationRequest<{
        declarations: TestDriveDeclaration[];
        currentAppointmentRevision: number;
      }>(base),
    retry: false,
    staleTime: 0,
    refetchInterval: 20_000,
  });
  const features = useDealerFeatures();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [link, setLink] = useState<{
    id: string;
    url: string;
    expiresAt: string;
  }>();
  const [email, setEmail] = useState(false);
  const attempt = useRef<{ requestId: string; token: string; expectedAppointmentRevision: number; expectedVehicleId: string } | undefined>(
    undefined,
  );
  const eligible = Boolean(
    booking.vehicleId &&
    booking.appointmentAt &&
    !booking.appointmentCancelledAt &&
    booking.appointmentStatus === "confirmed",
  );
  const refresh = () => client.invalidateQueries({ queryKey });
  async function create() {
    if (busy || !eligible || !features.enabled("testDriveDeclarations")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      attempt.current ??= {
        requestId: requestUuid(),
        token: declarationToken(),
        expectedAppointmentRevision: booking.appointmentRevision ?? 0,
        expectedVehicleId: booking.vehicleId!,
      };
      const result = await declarationRequest<{
        declaration: TestDriveDeclaration;
        url: string;
        replayed: boolean;
      }>(base, { ...attempt.current, expiresHours: 48 });
      if (result.declaration.current === false) {
        attempt.current = undefined;
        setNotice("The appointment has changed since this link was created. Refresh the booking before creating a replacement.");
        await refresh();
        return;
      }
      const relative = new URL(result.url, window.location.origin);
      // Only share this site's dedicated signing route, never an arbitrary API URL.
      if (
        (relative.protocol !== "https:" &&
          relative.origin !== window.location.origin) ||
        relative.pathname !==
          `/test-drive-declaration/${attempt.current.token}` ||
        relative.search ||
        relative.hash
      )
        throw new Error(
          "The signing link could not be verified. Refresh before sharing it.",
        );
      setLink({
        id: result.declaration.id,
        url: relative.href,
        expiresAt: result.declaration.expiresAt,
      });
      attempt.current = undefined;
      setNotice("Link ready. Nothing has been emailed.");
      await refresh();
    } catch (cause) {
      if (cause && typeof cause === "object" && "status" in cause && typeof cause.status === "number" && cause.status >= 400 && cause.status < 500) {
        attempt.current = undefined;
        await client.invalidateQueries({ queryKey: ["/api/test-drive-bookings"] });
      }
      setError(declarationError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(record: TestDriveDeclaration) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await declarationRequest(`${base}/${record.id}/revoke`, {});
      if (link?.id === record.id) setLink(undefined);
      await refresh();
      setNotice("Link revoked. Its history is preserved.");
    } catch (cause) {
      setError(declarationError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function check(
    record: TestDriveDeclaration,
    key: "licenceChecked" | "insuranceChecked",
    value: boolean,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await declarationRequest(`${base}/${record.id}/checks`, {
        expectedRevision: record.revision,
        licenceChecked: record.staffChecks.licenceChecked,
        insuranceChecked: record.staffChecks.insuranceChecked,
        [key]: value,
      });
      await refresh();
    } catch (cause) {
      setError(declarationError(cause));
    } finally {
      setBusy(false);
    }
  }
  const currentLink =
    link &&
    query.data?.declarations.find(
      (record) => record.id === link.id && record.status === "pending",
    );
  const message = link
    ? `Hello ${booking.customerName},\n\nPlease read and sign your test-drive declaration before your visit for ${booking.vehicleTitle || "your chosen car"}.\n\n${link.url}\n\nThis private link expires ${declarationTime(link.expiresAt)} (UK time). Please bring your driving licence. We will confirm the licence and insurance arrangements before you drive.\n\nIf any car or appointment details are wrong, please reply before signing.`
    : "";
  if (email && link)
    return (
      <EnquiryEmailComposer
        entry={booking}
        initialContent={{
          subject: "Your test-drive declaration",
          message,
          link: link.url,
          appendText: `Test-drive declaration: ${link.url}\nLink expires ${declarationTime(link.expiresAt)} (UK time).`,
        }}
        onClose={() => setEmail(false)}
        sendBlockedReason={query.isError ? 'The declaration status could not be checked. Refresh it before sending.' : !currentLink ? 'This declaration link is no longer awaiting a signature. Close this email to check the record or create a replacement before sending.' : undefined}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="portal-action-dialog portal-action-dialog-wide test-drive-declarations"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Test-drive declaration</DialogTitle>
          <DialogDescription>
            {booking.customerName} ·{" "}
            {booking.vehicleTitle || "Choose a car first"}. Create a private
            signing link.
          </DialogDescription>
        </DialogHeader>
        <p className="declaration-staff-note">
          <SignedDeclaration size={18} aria-hidden="true" />A signature records the
          customer’s declaration. Staff must still check their licence and the
          insurance cover for this drive.
        </p>
        {!eligible && (
          <p className="declaration-staff-warning">
            Confirm an appointment and select its car before creating a
            declaration.
          </p>
        )}
        {features.isError && (
          <p role="alert" className="declaration-staff-warning">
            Feature availability could not be checked.{" "}
            <button type="button" onClick={() => features.refetch()}>
              Retry availability
            </button>
          </p>
        )}
        {features.data && !features.enabled("testDriveDeclarations") && (
          <p className="declaration-staff-warning">
            New declaration links and signing are switched off by platform
            administration. Existing records remain available below.
          </p>
        )}
        {query.isLoading ? (
          <p role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading declaration records…
          </p>
        ) : query.isError ? (
          <div role="alert">
            <p>{declarationError(query.error)}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => query.refetch()}
            >
              Retry declarations
            </Button>
          </div>
        ) : (
          <>
            <div className="declaration-staff-actions">
              <Button
                type="button"
                disabled={
                  busy ||
                  !eligible ||
                  !features.enabled("testDriveDeclarations")
                }
                onClick={() => void create()}
              >
                <FileText size={18} aria-hidden="true" />
                {busy
                  ? "Working…"
                  : query.data?.declarations.some(
                        (record) => record.status === "pending",
                      )
                    ? "Create replacement link"
                    : "Create signing link"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Refresh declarations"
                disabled={busy || query.isFetching}
                onClick={() => query.refetch()}
              >
                <RefreshCw size={17} />
              </Button>
            </div>
            {query.data?.declarations.some(
              (record) => record.status === "pending",
            ) &&
              !link && (
                <p className="declaration-staff-muted">
                  For privacy, an existing link cannot be recovered here. Create
                  a replacement to share a new signing link; the previous unsigned
                  link will stop working.
                </p>
              )}
            {currentLink && link && (
              <section
                className="declaration-share"
                aria-label="Share declaration"
              >
                <div>
                  <h3>Read and sign on your phone</h3>
                  <p>Customer uses their own phone. No account needed.</p>
                  <label>
                    Private signing link
                    <input
                      readOnly
                      value={link.url}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <p className="declaration-staff-muted">
                    Expires {declarationTime(link.expiresAt)} (UK time).
                  </p>
                  <div className="declaration-staff-actions">
                    <DirectWhatsApp label="WhatsApp" enquiryId={booking.id} customerName={booking.customerName} customerPhone={booking.phone || ""} message={message} disabled={busy || query.isFetching || query.isError} beforeOpen={async () => {
                      const latest = await query.refetch();
                      if (latest.isError || !latest.data?.declarations.some(item => item.id === link.id && item.status === 'pending') || Date.parse(link.expiresAt) <= Date.now()) throw new Error('This declaration link is no longer available. Refresh the record before sharing.');
                    }} />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link.url);
                          setNotice("Signing link copied.");
                        } catch {
                          setError(
                            "Copy is unavailable. Select and copy the private signing link above.",
                          );
                        }
                      }}
                    >
                      <Copy size={16} />
                      Copy link
                    </Button>
                    {canEmail && features.enabled("customerEmails") && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEmail(true)}
                      >
                        <Mail size={16} />
                        Prepare email
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            )}
            {notice && (
              <p role="status" className="declaration-staff-success">
                {notice}
              </p>
            )}
            {!query.data?.declarations.length ? (
              <p className="declaration-staff-muted">
                No declaration yet. A link is tied to this appointment and car;
                changes require a new declaration.
              </p>
            ) : (
              <div className="declaration-records">
                {query.data.declarations.map((record) => (
                  <article key={record.id}>
                    <div className="declaration-record-heading">
                      {record.status === "signed" ? <SignedDeclaration size={19} aria-hidden="true" /> : <FileText size={19} aria-hidden="true" />}
                      <strong>{record.snapshot.vehicle.title}</strong>
                      <Chip
                        tone={
                          record.status === "signed"
                            ? "success"
                            : record.status === "pending"
                              ? "warning"
                              : "muted"
                        }
                      >
                        {labels[record.status]}
                      </Chip>
                    </div>
                    <p>
                      {declarationTime(record.snapshot.appointmentAt)} (UK time)
                      {record.snapshot.vehicle.registration
                        ? ` · ${record.snapshot.vehicle.registration}`
                        : ""}
                    </p>
                    {record.signedAt && (
                      <p>
                        <strong>{record.signerName}</strong> signed{" "}
                        {declarationTime(record.signedAt)} (UK time).
                      </p>
                    )}
                    {record.status === "signed" && record.current === false && (
                      <p className="declaration-staff-warning">
                        Historical signature. This declaration does not cover
                        the current appointment or vehicle details.
                      </p>
                    )}
                    <details>
                      <summary>Read recorded declaration</summary>
                      <div className="declaration-record-statement">
                        {record.statement}
                      </div>
                      <p className="declaration-staff-muted">
                        Statement {record.statementVersion}
                      </p>
                    </details>
                    {record.status === "signed" && record.current !== false && (
                      <fieldset className="declaration-staff-checks">
                        <legend>Staff checks for this drive</legend>
                        <label>
                          <input
                            type="checkbox"
                            checked={record.staffChecks.licenceChecked}
                            disabled={busy}
                            onChange={(event) =>
                              void check(
                                record,
                                "licenceChecked",
                                event.target.checked,
                              )
                            }
                          />
                          Driving licence checked
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={record.staffChecks.insuranceChecked}
                            disabled={busy}
                            onChange={(event) =>
                              void check(
                                record,
                                "insuranceChecked",
                                event.target.checked,
                              )
                            }
                          />
                          Insurance cover confirmed for this driver and vehicle
                        </label>
                        {record.staffChecks.checkedAt && (
                          <p>
                            Last recorded{" "}
                            {declarationTime(record.staffChecks.checkedAt)} (UK
                            time).
                          </p>
                        )}
                      </fieldset>
                    )}
                    {record.status === "pending" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void revoke(record)}
                      >
                        Revoke link
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="declaration-staff-error">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
