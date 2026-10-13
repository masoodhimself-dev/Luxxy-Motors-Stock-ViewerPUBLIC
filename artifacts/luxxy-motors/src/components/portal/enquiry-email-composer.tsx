import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type Enquiry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useRefreshDesk, workspaceError } from "./enquiry-workspace-tools";
import { requestUuid } from "@/lib/request-uuid";
import "./enquiry-email-composer.css";

type Delivery = {
  id: string;
  requestId: string;
  to: string;
  subject: string;
  status: "sending" | "sent" | "failed" | "unknown";
  photoCount: number;
  createdAt: string;
  error: string | null;
};
type EmailContext = {
  email: string;
  customerName: string;
  vehicleId: string | null;
  vehicleTitle: string | null;
  reference: string;
  revision: number;
  vehicleAvailable: boolean;
  appointmentAvailable: boolean;
  defaults: { subject: string; message: string };
  ready: boolean;
  photos: { id: string; byte_size: number; category?: string }[];
  deliveries: Delivery[];
};
type EmailDraft = {
  to: string;
  subject: string;
  message: string;
  includeVehicle: boolean;
  includeAppointment: boolean;
  photoIds: string[];
  expectedRevision: number;
};
type EmailPreview = {
  to: string;
  subject: string;
  text: string;
  previewHash: string;
  attachments: { id: string; filename: string; byteSize: number }[];
};
const request = <T,>(path: string, body?: unknown) =>
  customFetch<T>(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
const stateLabel = (state: Delivery["status"]) =>
  state === "sent"
    ? "Submitted to Resend"
    : state === "failed"
      ? "Not sent"
      : state === "unknown"
        ? "Acceptance unconfirmed"
        : "Sending — check before resending";

function Photo({
  carId,
  id,
  index,
  category,
}: {
  carId: string;
  id: string;
  index: number;
  category?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let disposed = false,
      object = "";
    void customFetch<Blob>(`/api/staff/inventory/${carId}/photos/${id}`, {
      responseType: "blob",
    })
      .then((blob) => {
        if (disposed) return;
        object = URL.createObjectURL(blob);
        setUrl(object);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (object) URL.revokeObjectURL(object);
    };
  }, [carId, id]);
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Inspect ${category === "pre_accident" ? "pre-accident" : "service-book"} photo ${index + 1}`}
    >
      <img src={url} alt={`${category === "pre_accident" ? "Pre-accident" : "Service-book"} photo ${index + 1}`} />
    </a>
  ) : (
    <span className="enquiry-email-photo-empty">Preview unavailable</span>
  );
}

/** No email leaves the app until staff review the server-generated message and confirm. */
export function EnquiryEmailComposer({
  entry,
  onClose,
}: {
  entry: Pick<Enquiry, "id" | "customerName" | "reference">;
  onClose: () => void;
}) {
  const base = `/api/staff/enquiries/${entry.id}`;
  const context = useQuery({
    queryKey: ["enquiry-email-context", entry.id],
    queryFn: () => request<EmailContext>(`${base}/email-context`),
    staleTime: 0,
    retry: false,
  });
  const refresh = useRefreshDesk(),
    initialized = useRef(false),
    busyRef = useRef(false),
    sendingRequest = useRef<{
      requestId: string;
      draft: EmailDraft;
      previewHash: string;
    } | null>(null);
  const [draft, setDraft] = useState<EmailDraft>({
    to: "",
    subject: "",
    message: "",
    includeVehicle: false,
    includeAppointment: false,
    photoIds: [],
    expectedRevision: 0,
  });
  const [preview, setPreview] = useState<EmailPreview | null>(null),
    [reviewedDraft, setReviewedDraft] = useState<EmailDraft | null>(null),
    [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!context.data || initialized.current) return;
    const data = context.data;
    initialized.current = true;
    setDraft({
      to: data.email,
      ...data.defaults,
      includeVehicle: data.vehicleAvailable,
      includeAppointment: data.appointmentAvailable,
      photoIds: [],
      expectedRevision: data.revision,
    });
  }, [context.data]);
  function change(value: Partial<EmailDraft>) {
    setDraft((d) => ({ ...d, ...value }));
    setPreview(null);
    setReviewedDraft(null);
    sendingRequest.current = null;
    setError("");
  }
  async function review() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request<EmailPreview>(
        `${base}/email-preview`,
        draft,
      );
      setPreview(result);
      setReviewedDraft({ ...draft, photoIds: [...draft.photoIds] });
      sendingRequest.current = null;
    } catch (cause) {
      setError(workspaceError(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function send() {
    if (!preview || !reviewedDraft || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    // A lost response retries the exact request; changing the draft creates a new review.
    try {
      sendingRequest.current ??= {
        requestId: requestUuid(),
        draft: reviewedDraft,
        previewHash: preview.previewHash,
      };
      const input = sendingRequest.current;
      const result = await request<{ delivery: Delivery }>(`${base}/email`, {
        ...input.draft,
        requestId: input.requestId,
        previewHash: input.previewHash,
      });
      setDelivery(result.delivery);
      await refresh();
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause &&
        "status" in cause &&
        [400, 409].includes(Number(cause.status))
      ) {
        sendingRequest.current = null;
        setPreview(null);
        setReviewedDraft(null);
      }
      setError(workspaceError(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const data = context.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busyRef.current) onClose();
      }}
    >
      <DialogContent className="portal-action-dialog enquiry-email-dialog">
        <DialogHeader>
          <DialogTitle>
            {delivery
              ? stateLabel(delivery.status)
              : preview
                ? "Review customer email"
                : "Email customer"}
          </DialogTitle>
          <DialogDescription>
            {entry.customerName} · {entry.reference}
          </DialogDescription>
        </DialogHeader>
        {context.isLoading && <p role="status">Loading email details…</p>}
        {context.isError && (
          <div>
            <p role="alert">{workspaceError(context.error)}</p>
            <Button variant="outline" onClick={() => void context.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {delivery ? (
          <div className="enquiry-email-result" role="status">
            <p>
              <strong>{delivery.to}</strong>
            </p>
            <p>{delivery.subject}</p>
            <p>
              {delivery.status === "sent"
                ? "Resend accepted this email for delivery. This does not confirm that it was delivered or read."
                : delivery.error ||
                  "This request is still recorded as sending. Check the email history and Resend before sending another copy."}
            </p>
            <p>
              {delivery.photoCount} vehicle photo
              {delivery.photoCount === 1 ? "" : "s"} · recorded in enquiry
              history
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          data && (
            <>
              {!data.ready && (
                <p role="status" className="enquiry-email-readiness">
                  Email is not enabled for this dealership. Ask the owner to
                  complete{" "}
                  <a href="/portal?section=settings">
                    Settings → API integrations → Resend
                  </a>
                  . You can prepare and review the message here.
                </p>
              )}
              {preview ? (
                <section
                  className="enquiry-email-review"
                  aria-label="Email preview"
                >
                  <dl>
                    <div>
                      <dt>To</dt>
                      <dd>{preview.to}</dd>
                    </div>
                    <div>
                      <dt>Subject</dt>
                      <dd>{preview.subject}</dd>
                    </div>
                  </dl>
                  <div className="enquiry-email-preview-copy">
                    {preview.text}
                  </div>
                  {preview.attachments.length > 0 && (
                    <div className="enquiry-email-attachment-list">
                      <strong>Attached vehicle photos</strong>
                      {preview.attachments.map((a) => (
                        <p key={a.id}>
                          {a.filename} · {Math.ceil(a.byteSize / 1024)} KB
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="enquiry-email-hint">
                    Check the recipient and any personal information in the
                    photos before sending.
                  </p>
                  <div className="enquiry-email-actions">
                    <Button
                      disabled={busy || !data.ready}
                      onClick={() => void send()}
                    >
                      {busy
                        ? "Sending…"
                        : sendingRequest.current
                          ? "Check or retry same email"
                          : "Send email"}
                    </Button>
                    <Button
                      disabled={busy || Boolean(sendingRequest.current)}
                      variant="outline"
                      onClick={() => {
                        setPreview(null);
                        setReviewedDraft(null);
                        sendingRequest.current = null;
                        setError("");
                      }}
                    >
                      Edit message
                    </Button>
                  </div>
                </section>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void review();
                  }}
                  className="enquiry-email-form"
                >
                  <fieldset disabled={busy}>
                    <label>
                      Customer email
                      <Input
                        autoFocus
                        type="email"
                        required
                        maxLength={254}
                        value={draft.to}
                        onChange={(event) => change({ to: event.target.value })}
                      />
                    </label>
                    <label>
                      Subject
                      <Input
                        required
                        maxLength={200}
                        value={draft.subject}
                        onChange={(event) =>
                          change({ subject: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Message
                      <Textarea
                        required
                        rows={7}
                        maxLength={12000}
                        value={draft.message}
                        onChange={(event) =>
                          change({ message: event.target.value })
                        }
                      />
                    </label>
                    {(data.vehicleAvailable || data.appointmentAvailable) && (
                      <div
                        className="enquiry-email-inclusions"
                        aria-label="Include details"
                      >
                        {data.vehicleAvailable && (
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.includeVehicle}
                              onChange={(event) =>
                                change({ includeVehicle: event.target.checked })
                              }
                            />
                            Vehicle details and current price
                          </label>
                        )}
                        {data.appointmentAvailable && (
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.includeAppointment}
                              onChange={(event) =>
                                change({
                                  includeAppointment: event.target.checked,
                                })
                              }
                            />
                            Appointment details
                          </label>
                        )}
                      </div>
                    )}
                    {data.vehicleId && (
                      <section
                        className="enquiry-email-service-book"
                        aria-label="Private vehicle-photo attachments"
                      >
                        <h3>
                          Vehicle photos <span>Optional</span>
                        </h3>
                        {data.photos.length ? (
                          <>
                            <p>
                              Select the pages to attach. Inspect them for
                              personal information first.
                            </p>
                            <div className="enquiry-email-photos">
                              {data.photos.map((photo, index) => (
                                <div key={photo.id}>
                                  <Photo
                                    carId={data.vehicleId!}
                                    id={photo.id}
                                    index={index}
                                    category={photo.category}
                                  />
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={draft.photoIds.includes(
                                        photo.id,
                                      )}
                                      onChange={(event) =>
                                        change({
                                          photoIds: event.target.checked
                                            ? [...draft.photoIds, photo.id]
                                            : draft.photoIds.filter(
                                                (id) => id !== photo.id,
                                              ),
                                        })
                                      }
                                    />
                                    {photo.category === "pre_accident" ? "Pre-accident" : "Service book"} · Photo {index + 1} ·{" "}
                                    {Math.ceil(photo.byte_size / 1024)} KB
                                  </label>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p>
                            No private vehicle photos uploaded yet.{" "}
                            <a
                              href={`/portal?section=inventory&vehicleId=${data.vehicleId}`}
                            >
                              Open this car in Cars
                            </a>{" "}
                            to upload them.
                          </p>
                        )}
                      </section>
                    )}
                  </fieldset>
                  <div className="enquiry-email-actions">
                    <Button type="submit" disabled={busy}>
                      {busy ? "Preparing preview…" : "Review email"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={onClose}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {data.deliveries.length > 0 && (
                <details className="enquiry-email-history">
                  <summary>Recent emails · {data.deliveries.length}</summary>
                  {data.deliveries.map((item) => (
                    <article key={item.id}>
                      <strong>{stateLabel(item.status)}</strong>
                      <p>{item.subject}</p>
                      <small>
                        {item.to} ·{" "}
                        {new Date(item.createdAt).toLocaleString("en-GB")}
                      </small>
                      {item.error && <p>{item.error}</p>}
                    </article>
                  ))}
                </details>
              )}
            </>
          )
        )}
        {error && (
          <p role="alert" className="enquiry-email-error">
            {error}
            {sendingRequest.current &&
              " Retry uses the same email request so it cannot create a duplicate."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
