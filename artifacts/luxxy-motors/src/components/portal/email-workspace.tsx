import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetEnquiries } from "@workspace/api-client-react";
import { Link, useLocation, useSearch } from "wouter";
import { Mail, Paperclip, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EmailDraftQueue } from "./email-draft-queue";
import { EnquiryEmailComposer } from "./enquiry-email-composer";
import { workspaceError } from "./enquiry-workspace-tools";
import { customerHistoryHref } from "./history-links";
import "./email-workspace.css";
type Message = {
  key: string;
  kind: "enquiry" | "sale" | "notification" | "reminder";
  customer_name: string;
  recipient: string;
  subject: string;
  status: string;
  created_at: string;
  vehicle_id: string | null;
  vehicle_title: string | null;
  enquiry_id: string | null;
  sale_id: string | null;
  document_id: string | null;
  reference: string;
  attachment_count: number;
  provider_id: string | null;
  last_event: string | null;
  checked_at: string | null;
};
const labels: Record<string, string> = {
  sent: "Submitted to Resend",
  prepared: "Prepared · not sent",
  sending: "Sending",
  unknown: "Acceptance unconfirmed",
  failed: "Failed",
  delivered: "Delivered",
  delivery_delayed: "Delivery delayed",
  bounced: "Bounced",
  complained: "Reported as spam",
  opened: "Opened",
  clicked: "Link clicked",
  suppressed: "Suppressed",
  scheduled: "Scheduled",
  queued: "Queued",
  canceled: "Cancelled",
};
export const emailStatusLabel = (value: string) =>
  labels[value] ?? "Status unavailable";
const date = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  });
export function EmailWorkspace({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const locationSearch = useSearch();
  const [, navigate] = useLocation();
  const initial = new URLSearchParams(locationSearch);
  const cache = useQueryClient();
  const [view, setView] = useState<"sent" | "drafts">(
    initial.get("view") === "sent" || initial.has("customer")
      ? "sent"
      : "drafts",
  );
  const openedRequest = useRef("");
  const enquiries = useGetEnquiries();
  const scopedEnquiryId =
    initial.get("enquiryId") || initial.get("compose") || initial.get("draft");
  const scopedEnquiry = enquiries.data?.find((e) => e.id === scopedEnquiryId);
  const unavailableContext = Boolean(scopedEnquiryId && !scopedEnquiry);
  const [search, setSearch] = useState(initial.get("customer") ?? ""),
    [query, setQuery] = useState(search),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<Message | null>(null),
    [compose, setCompose] = useState(false),
    [entryId, setEntryId] = useState(""),
    [customerSearch, setCustomerSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const history = useQuery({
    queryKey: ["staff-email", query, offset, scopedEnquiryId],
    enabled: view === "sent" && !unavailableContext,
    queryFn: () =>
      customFetch<{
        messages: Message[];
        hasMore: boolean;
        replyTo?: string | null;
      }>(
        `/api/staff/email?q=${encodeURIComponent(query)}&offset=${offset}${scopedEnquiryId ? `&enquiryId=${encodeURIComponent(scopedEnquiryId)}` : ""}`,
      ),
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["staff-email-message", selected?.key],
    enabled: !!selected,
    queryFn: () =>
      customFetch<{
        message: {
          message: string;
          attachments?: { id: string; filename: string; byteSize: number }[];
        };
      }>(`/api/staff/email/message/${encodeURIComponent(selected!.key)}`),
    retry: false,
  });
  const customers = (enquiries.data ?? []).filter((e) =>
    `${e.customerName} ${e.reference} ${e.vehicleTitle ?? ""} ${e.email ?? ""}`
      .toLowerCase()
      .includes(customerSearch.toLowerCase()),
  );
  const customer = enquiries.data?.find((e) => e.id === entryId);
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    if (params.get("view") === "drafts" || params.has("draft"))
      setView("drafts");
    else if (params.get("view") === "sent" || params.has("customer"))
      setView("sent");
    setSearch(params.get("customer") || "");
    setSelected(null);
    setOffset(0);
    setCompose(false);
    setEntryId("");
    setError("");
  }, [locationSearch]);
  useEffect(() => {
    const params = new URLSearchParams(locationSearch),
      id = params.get("draft") || params.get("compose");
    if (!id || !enquiries.data || openedRequest.current === locationSearch)
      return;
    openedRequest.current = locationSearch;
    if (enquiries.data.some((e) => e.id === id)) {
      setEntryId(id);
      setCompose(true);
      setError("");
    } else
      setError(
        "This enquiry is unavailable. Open Enquiries to find the current customer record.",
      );
  }, [locationSearch, enquiries.data]);
  const selectedKey = useRef<string | null>(null);
  selectedKey.current = selected?.key ?? null;
  async function checkStatus() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const status = await customFetch<{ event: string; checkedAt: string }>(
        `/api/staff/email/message/${encodeURIComponent(selected.key)}/status`,
        { method: "POST" },
      );
      setSelected((current) =>
        current?.key === selected.key
          ? {
              ...current,
              last_event: status.event,
              checked_at: status.checkedAt,
            }
          : current,
      );
      await history.refetch();
      await cache.invalidateQueries({ queryKey: ["staff-notifications"] });
    } catch (e) {
      if (selectedKey.current === selected.key) setError(workspaceError(e));
    } finally {
      setBusy(false);
    }
  }
  async function downloadPdf() {
    if (!selected?.sale_id || !selected.document_id || busy) return;
    setBusy(true);
    setError("");
    try {
      const blob = await customFetch<Blob>(
        `/api/sale-workspace/${selected.sale_id}/documents/${selected.document_id}/pdf`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selected.reference.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(workspaceError(e));
    } finally {
      setBusy(false);
    }
  }
  const currentStatus = selected?.last_event ?? selected?.status ?? "";
  return (
    <section className="email-workspace">
      <header className="email-heading">
        <div>
          {!embedded && (
            <p className="inventory-kicker">Customer correspondence</p>
          )}
          <h2>Email</h2>
          <p>
            Prepare replies, keep drafts and track sent messages in one place.
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            onClick={() => {
              if (view === "sent" && !unavailableContext)
                void history.refetch();
              void cache.invalidateQueries({
                queryKey: ["staff-email-drafts"],
              });
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
          <Button
            disabled={unavailableContext}
            onClick={() => {
              if (scopedEnquiry) {
                setEntryId(scopedEnquiry.id);
                setCompose(true);
              } else {
                setCompose(true);
                setEntryId("");
              }
            }}
          >
            <Mail size={16} />
            New email
          </Button>
        </div>
      </header>
      {scopedEnquiry && (
        <div className="email-customer-context">
          <div>
            <strong>{scopedEnquiry.customerName}</strong>
            <span>
              {scopedEnquiry.vehicleTitle || "General enquiry"} ·{" "}
              {scopedEnquiry.reference}
            </span>
          </div>
          <Link
            href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(scopedEnquiry.id)}`}
          >
            Open customer
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setQuery("");
              setSelected(null);
              setCompose(false);
              navigate("/portal?section=notifications&workView=email");
            }}
          >
            Show all email
          </Button>
        </div>
      )}
      {unavailableContext && (
        <div
          role={enquiries.isLoading ? "status" : "alert"}
          className="email-customer-context"
        >
          <span>
            {enquiries.isLoading
              ? "Loading this customer’s email…"
              : "This customer record could not be loaded. Refresh the enquiries or choose another customer."}
          </span>
          <Button
            variant="ghost"
            onClick={() =>
              navigate("/portal?section=notifications&workView=email")
            }
          >
            Show all email
          </Button>
        </div>
      )}
      <div className="email-view-tabs" role="group" aria-label="Email views">
        <Button
          variant={view === "drafts" ? "default" : "outline"}
          aria-pressed={view === "drafts"}
          onClick={() => setView("drafts")}
        >
          Drafts to review
        </Button>
        <Button
          variant={view === "sent" ? "default" : "outline"}
          aria-pressed={view === "sent"}
          onClick={() => setView("sent")}
        >
          Sent & delivery
        </Button>
        <span>Review replies before sending.</span>
      </div>
      {error && !selected && <p role="alert">{error}</p>}
      {compose && !customer && (
        <section className="email-customer-picker">
          <h3>Who are you emailing?</h3>
          <p>
            Choose a customer enquiry so the email stays attached to their car
            and history.
          </p>
          <Input
            aria-label="Find customer enquiry"
            placeholder="Customer, car or reference"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
          />
          <NativeSelect
            aria-label="Customer enquiry"
            value={entryId}
            onChange={(e) => setEntryId(e.target.value)}
          >
            <option value="">Choose customer / enquiry</option>
            {customers.map((e) => (
              <option key={e.id} value={e.id}>
                {e.customerName} · {e.reference} ·{" "}
                {e.vehicleTitle ?? "General enquiry"}
              </option>
            ))}
          </NativeSelect>
          {enquiries.isError && (
            <p role="alert">
              Could not load customer enquiries. Refresh the portal to retry.
            </p>
          )}
          <Button variant="ghost" onClick={() => setCompose(false)}>
            Cancel
          </Button>
          <Link href="/portal?section=notifications&workView=customers&deskView=new">
            Log a new customer enquiry
          </Link>
        </section>
      )}
      {compose && customer && (
        <EnquiryEmailComposer
          key={customer.id}
          entry={customer}
          onClose={(result) => {
            setView(result === "sent" ? "sent" : "drafts");
            setEntryId("");
            setCompose(false);
            setOffset(0);
            void history.refetch();
          }}
        />
      )}
      <label className="email-search">
        Search email
        <Input
          value={search}
          placeholder="Customer, email address, car, subject or reference"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {!unavailableContext &&
        (view === "drafts" ? (
          <EmailDraftQueue
            search={search}
            enquiryId={scopedEnquiryId || undefined}
            onOpen={(id) => {
              setEntryId(id);
              setCompose(true);
            }}
          />
        ) : (
          <>
            <div className={`email-columns${selected ? " has-selection" : ""}`}>
              <section
                className="email-message-list"
                aria-label="Sent email list"
              >
                {history.isLoading && <p role="status">Loading emails…</p>}
                {history.isError && (
                  <p role="alert">
                    Email history could not be loaded. Use Refresh to retry.
                  </p>
                )}
                {history.data?.messages.map((message) => (
                  <button
                    key={message.key}
                    type="button"
                    aria-pressed={selected?.key === message.key}
                    className={selected?.key === message.key ? "selected" : ""}
                    onClick={() => {
                      setSelected(message);
                      setError("");
                    }}
                  >
                    <span>
                      <strong>
                        {message.customer_name || message.recipient}
                      </strong>
                      <small>{date(message.created_at)}</small>
                    </span>
                    <b>{message.subject}</b>
                    <p>{message.vehicle_title || message.reference}</p>
                    <span className="email-row-meta">
                      <em>
                        {emailStatusLabel(message.last_event ?? message.status)}
                      </em>
                      {message.attachment_count > 0 && (
                        <small>
                          <Paperclip size={13} />
                          {message.attachment_count} attachment
                          {message.attachment_count === 1 ? "" : "s"}
                        </small>
                      )}
                    </span>
                  </button>
                ))}
                {!history.isLoading &&
                  !history.isError &&
                  !history.data?.messages.length && (
                    <div className="email-empty">
                      <Mail size={28} />
                      <h3>
                        {query
                          ? "No matching emails"
                          : "Your sent emails appear here"}
                      </h3>
                      <p>
                        Send a customer message or invoice to start its
                        correspondence history.
                      </p>
                    </div>
                  )}
                <div className="email-pagination">
                  <Button
                    variant="outline"
                    disabled={offset === 0}
                    onClick={() => {
                      setOffset(Math.max(0, offset - 50));
                      setSelected(null);
                    }}
                  >
                    Newer
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!history.data?.hasMore}
                    onClick={() => {
                      setOffset(offset + 50);
                      setSelected(null);
                    }}
                  >
                    Older
                  </Button>
                </div>
              </section>
              <section
                className="email-message-detail"
                aria-label="Email details"
              >
                {selected ? (
                  <>
                    <Button
                      className="email-back"
                      variant="ghost"
                      onClick={() => setSelected(null)}
                    >
                      Back to emails
                    </Button>
                    <p className="inventory-kicker">
                      {selected.kind === "sale"
                        ? "Invoice / sales document"
                        : "Customer message"}
                    </p>
                    <h3>{selected.subject}</h3>
                    <dl>
                      <div>
                        <dt>Customer</dt>
                        <dd>{selected.customer_name}</dd>
                      </div>
                      <div>
                        <dt>To</dt>
                        <dd>{selected.recipient}</dd>
                      </div>
                      <div>
                        <dt>Sent / attempted</dt>
                        <dd>{date(selected.created_at)}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{emailStatusLabel(currentStatus)}</dd>
                      </div>
                    </dl>
                    <div className="email-record-links">
                      {selected.enquiry_id && (
                        <Link
                          href={`/portal?section=notifications&workView=customers&enquiryId=${selected.enquiry_id}`}
                        >
                          Open enquiry
                        </Link>
                      )}
                      {selected.vehicle_id && (
                        <Link
                          href={`/portal?section=inventory&vehicleId=${selected.vehicle_id}`}
                        >
                          Open car
                        </Link>
                      )}
                      <Link
                        href={customerHistoryHref(
                          selected.kind === "sale" ? "sale" : "enquiry",
                          selected.sale_id ?? selected.enquiry_id ?? "",
                        )}
                      >
                        Customer history
                      </Link>
                      {selected.sale_id && (
                        <Link
                          href={`/portal?section=sales&saleId=${selected.sale_id}`}
                        >
                          Open sale
                        </Link>
                      )}
                      {selected.sale_id && selected.document_id && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void downloadPdf()}
                        >
                          Download original PDF
                        </Button>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy || !selected.provider_id}
                      onClick={() => void checkStatus()}
                    >
                      <RefreshCw size={15} />
                      {busy ? "Checking…" : "Check delivery status"}
                    </Button>
                    {selected.checked_at && (
                      <p className="email-note">
                        Last checked {date(selected.checked_at)}
                      </p>
                    )}
                    {error && (
                      <p role="alert" className="inventory-error">
                        {error}
                      </p>
                    )}
                    {["opened", "clicked"].includes(currentStatus) && (
                      <p className="email-note">
                        Open and click tracking can be affected by privacy
                        tools. This does not prove the customer read the
                        message.
                      </p>
                    )}
                    {detail.isLoading ? (
                      <p>Loading message…</p>
                    ) : detail.isError ? (
                      <p role="alert">The saved message could not be loaded.</p>
                    ) : (
                      <div className="email-message-body">
                        {detail.data?.message.message}
                      </div>
                    )}
                    {Boolean(detail.data?.message.attachments?.length) && (
                      <section>
                        <h4>Attachments</h4>
                        {detail.data!.message.attachments!.map((a) => (
                          <p key={a.id}>
                            {a.filename} · {Math.ceil(a.byteSize / 1024)} KB
                          </p>
                        ))}
                      </section>
                    )}
                    {selected.enquiry_id && (
                      <Button
                        onClick={() => {
                          setEntryId(selected.enquiry_id!);
                          setCompose(true);
                        }}
                      >
                        Prepare another reply
                      </Button>
                    )}
                    <p className="email-note">
                      {history.data?.replyTo
                        ? `Replies are addressed to ${history.data.replyTo}.`
                        : "Set a working reply-to address in Settings."}{" "}
                      Incoming replies are not shown in the portal yet.
                    </p>
                  </>
                ) : (
                  <div className="email-empty">
                    <Mail size={30} />
                    <h3>Select an email</h3>
                    <p>
                      See its message, attachments and delivery status alongside
                      the customer and car.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </>
        ))}
    </section>
  );
}
