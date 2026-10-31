import { AiReplyDraft } from './ai-reply-draft';
import { DirectWhatsApp } from "@/components/direct-whatsapp";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useDealerFeatures } from "@/lib/dealer-features";
import { CustomerEmailPreview } from "./customer-email-preview";
import "./enquiry-email-composer.css";

type Delivery = {
  id: string;
  requestId: string;
  to: string;
  subject: string;
  status: "sending" | "sent" | "failed" | "unknown";
  photoCount: number;
  documentCount?: number;
  createdAt: string;
  error: string | null;
  retryAt?: string | null;
  attempts?: number;
};
type EmailContext = {
  reviewRequest?: boolean;
  version?: number;
  savedDraft?: {
    version: number;
    status: string;
    source?: string;
    content: EmailDraft;
    updatedAt: string;
  } | null;
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
  templates?: { id: string; label: string; subject: string; message: string }[];
  invoices?: {
    id: string;
    title: string;
    number: string;
    saleId: string;
    issuedAt: string;
  }[];
  photos: { id: string; byte_size: number; category?: string }[];
  vehiclePhotos?: { index: number; url: string; caption?: string }[];
  deliveries: Delivery[];
};
type EmailDraft = {
  stockChange?: { taskId: string; revision: number };
  templateId?: string;
  to: string;
  subject: string;
  message: string;
  includeVehicle: boolean;
  includeAppointment: boolean;
  photoIds: string[];
  documentIds: string[];
  vehiclePhotoIndices?: number[];
  expectedRevision: number;
};
type EmailPreview = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  previewHash: string;
  attachments: { id: string; filename: string; byteSize: number }[];
};
export type SuggestedEmailContent = {
  subject: string;
  message: string;
  label: string;
  applyLabel?: string;
  includeVehicle?: boolean;
  templateId?: "enquiry_message";
};
export type InitialEmailContent = {
  subject: string;
  message: string;
  appendText: string;
  link: string;
};
export type ReplyInsertion = { id: number; text: string };
function EmailEditorFrame({
  inline,
  title,
  customerName,
  onClose,
  children,
}: {
  inline?: boolean;
  title: string;
  customerName: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (inline)
    return (
      <section
        className="enquiry-email-inline"
        aria-label="Customer reply editor"
      >
        <header className="enquiry-inline-heading">
          <h4>{title}</h4>
          <p>{customerName} · Review before sending</p>
        </header>
        {children}
      </section>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="portal-action-dialog enquiry-email-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{customerName}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
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
const deliveryLabel = (item: Delivery) =>
  item.status === "sending" && item.retryAt
    ? "Retry scheduled"
    : stateLabel(item.status);

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
      <img
        src={url}
        alt={`${category === "pre_accident" ? "Pre-accident" : "Service-book"} photo ${index + 1}`}
      />
    </a>
  ) : (
    <span className="enquiry-email-photo-empty">Preview unavailable</span>
  );
}

/** No email leaves the app until staff review the server-generated message and confirm. */
function EnquiryEmailEditor({
  entry,
  onClose,
  initialContent,
  suggestedContent,
  sendBlockedReason,
  verifyContext,
  sendRequestId,
  initialRecipient,
  messageMode,
  inline,
  channel = "email",
  customerPhone,
  insertion,
  onBusyChange,
  onChooseEmail,
}: {
  entry: Pick<Enquiry, "id" | "customerName" | "reference">;
  onClose: (result?: "sent" | "draft") => void;
  initialContent?: InitialEmailContent;
  suggestedContent?: SuggestedEmailContent;
  sendBlockedReason?: string;
  verifyContext?: () => Promise<void>;
  sendRequestId?: string;
  initialRecipient?: string;
  messageMode?: boolean;
  inline?: boolean;
  channel?: "email" | "whatsapp";
  customerPhone?: string | null;
  insertion?: ReplyInsertion;
  onBusyChange?: (busy: boolean) => void;
  onChooseEmail?: () => void;
}) {
  const base = `/api/staff/enquiries/${entry.id}`;
  const features = useDealerFeatures();
  const contextKey = ["enquiry-email-context", entry.id] as const;
  const context = useQuery({
    queryKey: contextKey,
    queryFn: () => request<EmailContext>(`${base}/email-context`),
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
  const refresh = useRefreshDesk(),
    initialized = useRef(false),
    busyRef = useRef(false),
    sendingRequest = useRef<{
      requestId: string;
      draft: EmailDraft;
      previewHash: string;
      savedDraftVersion?: number;
    } | null>(null);
  const cache = useQueryClient();
  const savedVersion = useRef(0);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const [dirty, setDirty] = useState(false),
    [saveNotice, setSaveNotice] = useState("");
  const [draft, setDraft] = useState<EmailDraft>({
    to: "",
    subject: "",
    message: "",
    includeVehicle: false,
    includeAppointment: false,
    photoIds: [],
    documentIds: [],
    expectedRevision: 0,
  });
  const [preview, setPreview] = useState<EmailPreview | null>(null),
    [reviewedDraft, setReviewedDraft] = useState<EmailDraft | null>(null),
    [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busyAction, setBusyAction] = useState<
    "save" | "review" | "send" | "status" | null
  >(null);
  const busy = busyAction !== null;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const [error, setError] = useState("");
  const appliedInsertion = useRef<number | null>(null);
  useEffect(() => {
    if (
      !context.data ||
      !context.isFetchedAfterMount ||
      context.isFetching ||
      context.isError ||
      initialized.current
    )
      return;
    const data = context.data;
    initialized.current = true;
    savedVersion.current = data.version ?? 0;
    if (data.savedDraft) {
      setDraft(data.savedDraft.content);
      setSaveNotice("Saved draft restored · not sent");
      return;
    }
    setSuggestionApplied(Boolean(suggestedContent));
    setDraft({
      ...(suggestedContent?.templateId
        ? { templateId: suggestedContent.templateId }
        : {}),
      to:
        initialRecipient &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(initialRecipient.trim())
          ? initialRecipient.trim()
          : data.email,
      ...(initialContent
        ? { subject: initialContent.subject, message: initialContent.message }
        : suggestedContent
          ? {
              subject: suggestedContent.subject,
              message: suggestedContent.message,
            }
          : data.defaults),
      includeVehicle:
        data.reviewRequest || suggestedContent?.includeVehicle === false
          ? false
          : data.vehicleAvailable,
      includeAppointment:
        suggestedContent || data.reviewRequest
          ? false
          : data.appointmentAvailable,
      photoIds: [],
      documentIds: [],
      expectedRevision: data.revision,
    });
  }, [
    context.data,
    context.isFetchedAfterMount,
    context.isFetching,
    context.isError,
    initialContent,
    suggestedContent,
    initialRecipient,
  ]);
  function change(value: Partial<EmailDraft>) {
    setDraft((d) => ({ ...d, ...value }));
    setDirty(true);
    setSaveNotice("Unsaved changes");
    setPreview(null);
    setReviewedDraft(null);
    sendingRequest.current = null;
    setError("");
  }
  useEffect(() => {
    if (
      !initialized.current ||
      !insertion ||
      appliedInsertion.current === insertion.id
    )
      return;
    appliedInsertion.current = insertion.id;
    setDraft((current) => ({
      ...current,
      message: `${current.message.trim()}\n\n${insertion.text}`.trim(),
    }));
    setDirty(true);
    setSaveNotice("Unsaved changes");
    setPreview(null);
    setReviewedDraft(null);
    sendingRequest.current = null;
  }, [
    insertion,
    context.data,
    context.isFetchedAfterMount,
    context.isFetching,
    context.isError,
  ]);
  useEffect(() => {
    setPreview(null);
    setReviewedDraft(null);
  }, [channel]);
  async function persistDraft() {
    if (draft.stockChange)
      throw new Error(
        "Start a new message before saving or sending this archived price-update draft.",
      );
    const result = await request<{
      version: number;
      savedDraft?: EmailContext["savedDraft"];
    }>(`${base}/email-draft`, {
      expectedVersion: savedVersion.current,
      content: draft,
    });
    savedVersion.current = result.version;
    await cache.cancelQueries({ queryKey: contextKey, exact: true });
    cache.setQueryData<EmailContext>(contextKey, (current) => {
      if (!current) return current;
      const source = draft.templateId ? "template" : "manual";
      return {
        ...current,
        version: result.version,
        savedDraft: result.savedDraft ?? {
          version: result.version,
          status: "draft",
          source,
          content: {
            ...draft,
            photoIds: [...draft.photoIds],
            documentIds: [...draft.documentIds],
          },
          updatedAt: new Date().toISOString(),
        },
      };
    });
    setDirty(false);
    setSaveNotice("Draft saved · not sent");
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["staff-email-drafts"] }),
      cache.invalidateQueries({ queryKey: ["staff-notifications"] }),
      cache.invalidateQueries({ queryKey: ["reply-attention"] }),
    ]);
  }
  async function saveDraft() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyAction("save");
    setError("");
    try {
      await persistDraft();
    } catch (cause) {
      setError(workspaceError(cause));
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  }
  function close() {
    if (busyRef.current) return;
    if (
      dirty &&
      !window.confirm(
        "Close without saving your latest changes? The last saved draft will remain.",
      )
    )
      return;
    onClose("draft");
  }
  async function review() {
    if (busyRef.current) return;
    if (missingAttachment) {
      setError(missingAttachment);
      return;
    }
    busyRef.current = true;
    setBusyAction("review");
    setError("");
    try {
      await verifyContext?.();
      await persistDraft();
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
      setBusyAction(null);
    }
  }
  async function send() {
    if (
      !preview ||
      !reviewedDraft ||
      reviewedDraft.stockChange ||
      busyRef.current ||
      !features.enabled("customerEmails") ||
      sendBlockedReason
    )
      return;
    busyRef.current = true;
    setBusyAction("send");
    setError("");
    // A lost response retries the exact request; changing the draft creates a new review.
    try {
      await verifyContext?.();
      sendingRequest.current ??= {
        requestId: sendRequestId || requestUuid(),
        draft: reviewedDraft,
        previewHash: preview.previewHash,
        savedDraftVersion: savedVersion.current,
      };
      const input = sendingRequest.current;
      const result = await request<{ delivery: Delivery }>(`${base}/email`, {
        ...input.draft,
        requestId: input.requestId,
        previewHash: input.previewHash,
        savedDraftVersion: input.savedDraftVersion,
      });
      setDelivery(result.delivery);
      setDirty(false);
      await Promise.all([
        refresh(),
        cache.invalidateQueries({ queryKey: ["staff-email-drafts"] }),
        cache.invalidateQueries({ queryKey: ["staff-notifications"] }),
        cache.invalidateQueries({ queryKey: ["reply-attention"] }),
        cache.invalidateQueries({ queryKey: ["staff-email"] }),
        cache.invalidateQueries({ queryKey: ["staff-email-conversation"] }),
      ]);
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
      setBusyAction(null);
    }
  }
  async function refreshDelivery() {
    if (!delivery || busyRef.current) return;
    busyRef.current = true;
    setBusyAction("status");
    setError("");
    try {
      // This reads our saved journal only. It never sends or re-approves mail.
      const result = await context.refetch({ throwOnError: true });
      const latest = result.data?.deliveries.find(
        (item) => item.id === delivery.id,
      );
      if (!latest)
        throw new Error(
          "The saved email status is unavailable. Open the email workspace to check it.",
        );
      setDelivery(latest);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["staff-email"] }),
        cache.invalidateQueries({ queryKey: ["staff-email-conversation"] }),
      ]);
    } catch {
      setError(
        "Could not refresh the saved status. Your existing email request is unchanged.",
      );
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  }
  const data = initialized.current ? context.data : undefined;
  const preparingMessage = messageMode || channel === "whatsapp";
  const whatsappAttachments = Boolean(
    draft.photoIds.length ||
    draft.documentIds.length ||
    draft.vehiclePhotoIndices?.length,
  );
  const vehicleLink = data?.vehicleId
    ? `${window.location.origin}/vehicle/${encodeURIComponent(data.vehicleId)}`
    : "";
  const whatsappText = [
    draft.message.trim(),
    draft.includeVehicle && vehicleLink && !draft.message.includes(vehicleLink)
      ? `${data?.vehicleTitle || "Vehicle details"}: ${vehicleLink}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  async function verifyWhatsAppContext() {
    await verifyContext?.();
    const current = await request<EmailContext>(`${base}/email-context`);
    cache.setQueryData(contextKey, current);
    if (
      !data ||
      current.revision !== draft.expectedRevision ||
      current.vehicleId !== data.vehicleId
    ) {
      throw new Error(
        "This enquiry changed. Save your wording, refresh the customer workspace and check the current vehicle and appointment before sharing.",
      );
    }
  }
  const photoCategory =
    draft.templateId === "service_history"
      ? "service_book"
      : draft.templateId === "pre_accident_photos"
        ? "pre_accident"
        : null;
  const missingAttachment =
    draft.templateId === "invoice_copy" && !draft.documentIds.length
      ? "Choose an invoice to attach, or use a different template."
      : photoCategory &&
          !data?.photos.some(
            (photo) =>
              draft.photoIds.includes(photo.id) &&
              (photo.category ?? "service_book") === photoCategory,
          )
        ? `Choose at least one ${photoCategory === "pre_accident" ? "pre-accident" : "service-book"} photo to attach, or use a different template.`
        : "";
  return (
    <EmailEditorFrame
      inline={inline}
      onClose={close}
      customerName={entry.customerName}
      title={
        delivery
          ? deliveryLabel(delivery)
          : preview
            ? "Review customer email"
            : channel === "whatsapp"
              ? "Prepare WhatsApp message"
              : preparingMessage
                ? "Prepare customer message"
                : "Prepare customer email"
      }
    >
      <div data-message-dirty={dirty ? "true" : undefined}>
        {!initialized.current && !context.isError && (
          <p role="status">Loading latest email details…</p>
        )}
        {context.isError && !delivery && (
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
            {delivery.status === "sending" &&
              delivery.retryAt &&
              Number.isFinite(Date.parse(delivery.retryAt)) && (
                <p>
                  Next attempt:{" "}
                  {new Date(delivery.retryAt).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  (UK). The same approved email is queued. You do not need to
                  send another copy.
                </p>
              )}
            <p>
              {delivery.status === "sent"
                ? "Resend accepted this email for delivery. This does not confirm that it was delivered or read."
                : delivery.error ||
                  "This request is still recorded as sending. Check the email history and Resend before sending another copy."}
            </p>
            <p>
              {delivery.photoCount} vehicle photo
              {delivery.photoCount === 1 ? "" : "s"} ·{" "}
              {delivery.documentCount ?? 0} invoice(s) · recorded in enquiry
              history
            </p>
            <Button
              onClick={() =>
                onClose(delivery.status === "sent" ? "sent" : "draft")
              }
            >
              Done
            </Button>
            {["sending", "unknown"].includes(delivery.status) && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void refreshDelivery()}
              >
                {busyAction === "status"
                  ? "Refreshing status…"
                  : "Refresh saved status"}
              </Button>
            )}
            {["sending", "unknown"].includes(delivery.status) && (
              <p className="enquiry-email-hint">
                Refreshing reads the saved status. It does not send an email.
              </p>
            )}
          </div>
        ) : (
          data && (
            <>
              {!features.enabled("customerEmails") && (
                <p className="enquiry-email-readiness" role="status">
                  {features.isLoading
                    ? "Checking email availability…"
                    : features.isError
                      ? "Email availability could not be checked. Sending is paused; your draft is safe."
                      : "Email sending is switched off by platform administration. You can still prepare and save drafts."}
                </p>
              )}
              {sendBlockedReason && (
                <p className="enquiry-email-readiness" role="status">
                  {sendBlockedReason} Your text is kept here and can be saved as
                  a draft.
                </p>
              )}
              {draft.stockChange && (
                <div className="enquiry-email-readiness" role="alert">
                  <p>
                    This archived price-update draft cannot be sent. Start a new
                    message using the current enquiry details.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      change({
                        stockChange: undefined,
                        templateId: undefined,
                        subject: data.defaults.subject,
                        message: data.defaults.message,
                        expectedRevision: data.revision,
                      })
                    }
                  >
                    Start a new message
                  </Button>
                </div>
              )}
              {!data.ready && (
                <p role="status" className="enquiry-email-readiness">
                  Email is not enabled for this dealership. Ask the platform
                  administrator to connect the sender. Review wording in{" "}
                  <a href="/portal?section=settings&settingsTab=emails">
                    Message settings
                  </a>
                  . You can prepare and review the message here.
                </p>
              )}
              {saveNotice && (
                <p className="enquiry-email-save-state" role="status">
                  {saveNotice}
                </p>
              )}
              {data.savedDraft &&
              ["sending", "unknown"].includes(data.savedDraft.status) ? (
                <div className="enquiry-email-readiness">
                  <p>
                    This draft has an unresolved send. Check Email history and
                    the provider before sending another copy.
                  </p>
                  <Button variant="outline" onClick={close}>
                    Close draft
                  </Button>
                </div>
              ) : (
                <>
                  {draft.expectedRevision !== data.revision && (
                    <div className="enquiry-email-readiness">
                      <p>
                        The enquiry changed since this draft was saved. Check
                        the customer, car, appointment and attachments.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          change({ expectedRevision: data.revision })
                        }
                      >
                        Use latest enquiry details
                      </Button>
                    </div>
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
                      <CustomerEmailPreview
                        html={preview.html}
                        text={preview.text}
                      />
                      {preview.attachments.length > 0 && (
                        <div className="enquiry-email-attachment-list">
                          <strong>Attachments</strong>
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
                          disabled={
                            busy ||
                            !data.ready ||
                            !features.enabled("customerEmails") ||
                            !!sendBlockedReason
                          }
                          onClick={() => void send()}
                        >
                          {busyAction === "send"
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
                      {suggestedContent && (
                        <div className="enquiry-email-readiness" role="status">
                          <p>
                            {suggestionApplied
                              ? `${suggestedContent.label} prepared. Edit the wording and review before sending.`
                              : `Your saved draft has been kept. You can choose the ${suggestedContent.label.toLowerCase()} wording instead.`}
                          </p>
                          {!suggestionApplied && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                change({
                                  templateId: suggestedContent.templateId,
                                  subject: suggestedContent.subject,
                                  message: suggestedContent.message,
                                  includeAppointment: false,
                                  ...(suggestedContent.includeVehicle === false
                                    ? { includeVehicle: false }
                                    : {}),
                                });
                                setSuggestionApplied(true);
                              }}
                            >
                              {suggestedContent.applyLabel ||
                                `Use ${suggestedContent.label.toLowerCase()} wording`}
                            </Button>
                          )}
                        </div>
                      )}
                      {initialContent &&
                        !draft.message.includes(initialContent.link) && (
                          <div className="enquiry-email-readiness">
                            <p>
                              Your saved message has been kept. Add the private
                              declaration link when you are ready.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                change({
                                  message:
                                    `${draft.message.trim()}\n\n${initialContent.appendText}`.trim(),
                                })
                              }
                            >
                              Add declaration link
                            </Button>
                          </div>
                        )}
                      <AiReplyDraft key={entry.id} enquiryId={entry.id} disabled={busy} onApply={text=>change({message:text})} />
                      <fieldset disabled={busy}>
                        {initialRecipient &&
                          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                            initialRecipient.trim(),
                          ) &&
                          draft.to !== initialRecipient.trim() && (
                            <div className="enquiry-email-readiness">
                              <p>
                                Your saved draft’s email address has been kept.
                                The sharing window selected{" "}
                                {initialRecipient.trim()}.
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  change({ to: initialRecipient.trim() })
                                }
                              >
                                Use email address {initialRecipient.trim()}
                              </Button>
                            </div>
                          )}
                        <label>
                          {preparingMessage
                            ? "Customer email (optional for WhatsApp)"
                            : "Customer email"}
                          <Input
                            autoFocus={!inline}
                            type="email"
                            required={!preparingMessage}
                            maxLength={254}
                            value={draft.to}
                            onChange={(event) =>
                              change({ to: event.target.value })
                            }
                          />
                        </label>
                        {Boolean(data.templates?.length) && (
                          <label>
                            Start from a template
                            <select
                              aria-label="Email template"
                              value={draft.templateId ?? ""}
                              onChange={(event) => {
                                const selected = data.templates?.find(
                                  (t) => t.id === event.target.value,
                                );
                                if (!selected) {
                                  change({ templateId: undefined });
                                  return;
                                }
                                if (selected) {
                                  const category =
                                    selected.id === "service_history"
                                      ? "service_book"
                                      : selected.id === "pre_accident_photos"
                                        ? "pre_accident"
                                        : null;
                                  change({
                                    templateId: selected.id,
                                    subject: selected.subject,
                                    message: selected.message,
                                    includeAppointment:
                                      selected.id === "appointment_details" &&
                                      data.appointmentAvailable,
                                    documentIds:
                                      selected.id === "invoice_copy"
                                        ? data.invoices?.[0]
                                          ? [data.invoices[0].id]
                                          : []
                                        : draft.documentIds,
                                    photoIds: category
                                      ? data.photos
                                          .filter(
                                            (p) =>
                                              (p.category ?? "service_book") ===
                                              category,
                                          )
                                          .map((p) => p.id)
                                      : draft.photoIds,
                                  });
                                }
                              }}
                            >
                              <option value="">Custom message</option>
                              {data.templates?.map((t) => (
                                <option
                                  key={t.id}
                                  value={t.id}
                                  disabled={
                                    (t.id === "invoice_copy" &&
                                      !data.invoices?.length) ||
                                    (t.id === "appointment_details" &&
                                      !data.appointmentAvailable) ||
                                    (t.id === "service_history" &&
                                      !data.photos.some(
                                        (p) =>
                                          (p.category ?? "service_book") ===
                                          "service_book",
                                      )) ||
                                    (t.id === "pre_accident_photos" &&
                                      !data.photos.some(
                                        (p) => p.category === "pre_accident",
                                      ))
                                  }
                                >
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

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

                        {Boolean(data.vehiclePhotos?.length) && (
                          <details className="enquiry-email-service-book">
                            <summary>Car photographs · optional links</summary>
                            <p>Choose up to four existing car photographs.</p>
                            <div className="grid grid-cols-2 gap-3">
                              {data.vehiclePhotos!.map((photo) => {
                                const selected =
                                  draft.vehiclePhotoIndices ?? [];
                                return (
                                  <label
                                    key={photo.index}
                                    className="grid gap-2"
                                  >
                                    <img
                                      src={photo.url}
                                      alt={
                                        photo.caption ||
                                        `Car photograph ${photo.index + 1}`
                                      }
                                      loading="lazy"
                                      className="aspect-video w-full object-cover"
                                    />
                                    <span>
                                      <input
                                        type="checkbox"
                                        checked={selected.includes(photo.index)}
                                        disabled={
                                          !selected.includes(photo.index) &&
                                          selected.length >= 4
                                        }
                                        onChange={(event) =>
                                          change({
                                            vehiclePhotoIndices: event.target
                                              .checked
                                              ? [...selected, photo.index]
                                              : selected.filter(
                                                  (index) =>
                                                    index !== photo.index,
                                                ),
                                          })
                                        }
                                      />{" "}
                                      {photo.caption ||
                                        `Photograph ${photo.index + 1}`}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </details>
                        )}
                        {Boolean(data.invoices?.length) && (
                          <fieldset className="enquiry-email-service-book">
                            <legend>Saved invoices · optional</legend>
                            {data.invoices!.map((invoice) => (
                              <label key={invoice.id}>
                                <input
                                  type="checkbox"
                                  checked={draft.documentIds.includes(
                                    invoice.id,
                                  )}
                                  disabled={
                                    !draft.documentIds.includes(invoice.id) &&
                                    draft.documentIds.length >= 3
                                  }
                                  onChange={(event) =>
                                    change({
                                      documentIds: event.target.checked
                                        ? [...draft.documentIds, invoice.id]
                                        : draft.documentIds.filter(
                                            (id) => id !== invoice.id,
                                          ),
                                    })
                                  }
                                />
                                {invoice.title} · {invoice.number}
                              </label>
                            ))}
                          </fieldset>
                        )}
                        {(data.vehicleAvailable ||
                          data.appointmentAvailable) && (
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
                                    change({
                                      includeVehicle: event.target.checked,
                                    })
                                  }
                                />
                                Vehicle details and current price
                              </label>
                            )}
                            {data.appointmentAvailable &&
                              channel !== "whatsapp" && (
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={draft.includeAppointment}
                                    onChange={(event) =>
                                      change({
                                        includeAppointment:
                                          event.target.checked,
                                      })
                                    }
                                  />
                                  Appointment details
                                </label>
                              )}
                          </div>
                        )}
                        {data.vehicleId && data.photos.length > 0 && (
                          <section
                            className="enquiry-email-service-book"
                            aria-label="Private vehicle-photo attachments"
                          >
                            <h3>
                              Service-book &amp; history photos{" "}
                              <span>Optional</span>
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
                                        {photo.category === "pre_accident"
                                          ? "Pre-accident"
                                          : "Service book"}{" "}
                                        · Photo {index + 1} ·{" "}
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
                                  href={`/vehicle/${data.vehicleId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View vehicle details
                                </a>{" "}
                                to upload them.
                              </p>
                            )}
                          </section>
                        )}
                      </fieldset>
                      {missingAttachment && (
                        <p
                          role="status"
                          className="enquiry-email-attachment-warning"
                        >
                          {missingAttachment}
                        </p>
                      )}
                      <div className="enquiry-email-actions">
                        {(channel === "whatsapp" || !inline) && (
                          <DirectWhatsApp
                            enquiryId={entry.id}
                            customerName={entry.customerName}
                            customerPhone={customerPhone || ""}
                            message={whatsappText}
                            disabled={
                              busy ||
                              Boolean(sendingRequest.current) ||
                              !!sendBlockedReason ||
                              Boolean(draft.stockChange) ||
                              !draft.message.trim() ||
                              whatsappAttachments ||
                              draft.expectedRevision !== data.revision
                            }
                            beforeOpen={verifyWhatsAppContext}
                            onEmailFallback={(body) => {
                              change({ message: body });
                              setSaveNotice(
                                "Check the address, then review before sending.",
                              );
                              onChooseEmail?.();
                            }}
                          />
                        )}
                        {channel !== "whatsapp" && (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              busy ||
                              Boolean(draft.stockChange) ||
                              draft.expectedRevision !== data.revision
                            }
                            onClick={() => void saveDraft()}
                          >
                            {busyAction === "save"
                              ? "Saving draft…"
                              : "Save draft"}
                          </Button>
                        )}
                        {channel !== "whatsapp" && (
                          <Button
                            type="submit"
                            disabled={
                              busy ||
                              Boolean(draft.stockChange) ||
                              draft.expectedRevision !== data.revision ||
                              !draft.to.trim() ||
                              Boolean(missingAttachment)
                            }
                          >
                            {busyAction === "review"
                              ? "Preparing preview…"
                              : "Review email"}
                          </Button>
                        )}
                        {!inline && (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={close}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                      {channel === "whatsapp" && (
                        <p className="enquiry-email-hint">
                          WhatsApp opens on your device. After sending, choose
                          “I’ve sent it” to save the exact message in this
                          enquiry.{" "}
                          {whatsappAttachments
                            ? "Selected email attachments cannot be included in this handoff. Use Email, or remove the selected attachments before continuing."
                            : "Vehicle links are included when selected. Use Email for invoice and photo attachments."}
                        </p>
                      )}
                    </form>
                  )}
                </>
              )}
              {data.deliveries.length > 0 && (
                <details className="enquiry-email-history">
                  <summary>Recent emails · {data.deliveries.length}</summary>
                  {data.deliveries.map((item) => (
                    <article key={item.id}>
                      <strong>{deliveryLabel(item)}</strong>
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
            {!delivery &&
              sendingRequest.current &&
              " Retry uses the same email request so it cannot create a duplicate."}
          </p>
        )}
        {inline && error && !delivery && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || context.isFetching}
            onClick={() => void context.refetch()}
          >
            Refresh message details
          </Button>
        )}
      </div>
    </EmailEditorFrame>
  );
}

export function EnquiryEmailComposer(props: {
  entry: Pick<Enquiry, "id" | "customerName" | "reference">;
  onClose: (result?: "sent" | "draft") => void;
  initialContent?: InitialEmailContent;
  suggestedContent?: SuggestedEmailContent;
  sendBlockedReason?: string;
  verifyContext?: () => Promise<void>;
  sendRequestId?: string;
  initialRecipient?: string;
  messageMode?: boolean;
  inline?: boolean;
  channel?: "email" | "whatsapp";
  customerPhone?: string | null;
  insertion?: ReplyInsertion;
  onBusyChange?: (busy: boolean) => void;
  onChooseEmail?: () => void;
}) {
  return <EnquiryEmailEditor key={props.entry.id} {...props} />;
}
