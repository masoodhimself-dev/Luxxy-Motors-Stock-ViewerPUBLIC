import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  saleHandoverMessage,
  saleHandoverStatus,
  saleWorkspaceTotals,
  type SaleWorkspaceRecord,
  type SaleWorkspaceFulfilment,
  type SaleWorkspaceDraft,
} from "@workspace/vehicle-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DirectWhatsApp } from "@/components/direct-whatsapp";
import { InternalShareEmail } from "@/components/internal-share-email";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { useStaffAccess } from "./dealer-administration";
import { HandoverDialog } from "@/components/sales-demo/sales-controls";
import "./sale-handover.css";

type HandoverDraft = Pick<
  SaleWorkspaceDraft,
  "customer" | "phone" | "address" | "fulfilment"
>;
export function handoverDefaults(
  draft: HandoverDraft,
): SaleWorkspaceFulfilment {
  return (
    draft.fulfilment || {
      method: "collection",
      viewed: "not-yet-viewed",
      address: draft.address,
      recipient: draft.customer,
      phone: draft.phone,
      scheduledDate: "",
      timeWindow: "",
      instructions: "",
      stage: "to_arrange",
    }
  );
}
export function SaleHandoverFields({
  draft,
  value,
  onChange,
  disabled = false,
}: {
  draft: HandoverDraft;
  value: SaleWorkspaceFulfilment;
  onChange: (v: SaleWorkspaceFulfilment) => void;
  disabled?: boolean;
}) {
  const field = (key: keyof SaleWorkspaceFulfilment, next: string) =>
    onChange({ ...value, [key]: next });
  return (
    <fieldset disabled={disabled} className="handover-fields">
      <legend>How will the customer receive the car?</legend>
      <div
        className="handover-method"
        role="group"
        aria-label="Collection or delivery"
      >
        {(["collection", "delivery"] as const).map((method) => (
          <Button
            type="button"
            key={method}
            variant={value.method === method ? "default" : "outline"}
            aria-pressed={value.method === method}
            onClick={() =>
              onChange({
                ...value,
                method,
                recipient: value.recipient || draft.customer,
                phone: value.phone || draft.phone,
                address: value.address || draft.address,
              })
            }
          >
            {method === "delivery"
              ? "Deliver to customer"
              : "Customer collecting"}
          </Button>
        ))}
      </div>
      <div className="handover-grid">
        <label>
          Planned date
          <Input
            type="date"
            value={value.scheduledDate}
            onChange={(e) => field("scheduledDate", e.target.value)}
          />
        </label>
        <label>
          Arrival window (UK time)
          <Input
            value={value.timeWindow}
            maxLength={100}
            placeholder="For example, 14:00–16:00"
            onChange={(e) => field("timeWindow", e.target.value)}
          />
        </label>
        <label>
          Recipient
          <Input
            value={value.recipient}
            maxLength={200}
            onChange={(e) => field("recipient", e.target.value)}
          />
        </label>
        <label>
          Contact number
          <Input
            type="tel"
            value={value.phone}
            maxLength={80}
            onChange={(e) => field("phone", e.target.value)}
          />
        </label>
      </div>
      {value.method === "delivery" && (
        <>
          <label>
            Delivery address
            <Textarea
              rows={3}
              value={value.address}
              maxLength={2000}
              onChange={(e) => field("address", e.target.value)}
            />
          </label>
          <p>
            Confirm this address with the customer. It may differ from their
            invoice address.
          </p>
        </>
      )}
      <label>
        {value.method === "delivery"
          ? "Staff delivery notes"
          : "Staff collection notes"}
        <Textarea
          value={value.instructions}
          maxLength={2000}
          onChange={(e) => field("instructions", e.target.value)}
        />
      </label>
      <p>
        Leave the date blank if it is still to be arranged. Saving arrangements
        does not record payment or mark the car handed over. Add any delivery
        fee through the existing fees section before issuing the invoice.
      </p>
    </fieldset>
  );
}
export function SaleHandover({
  sale,
  onSaved,
}: {
  sale: SaleWorkspaceRecord;
  onSaved: (sale: SaleWorkspaceRecord) => void;
}) {
  const cache = useQueryClient(),
    access = useStaffAccess(),
    { settings } = useDealerSettings();
  const value = handoverDefaults(sale.draft);
  const [form, setForm] = useState(value),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false),
    [confirm, setConfirm] = useState(false),
    [email, setEmail] = useState(false),
    [emailMessage, setEmailMessage] = useState("");
  const attempt = useRef<{ path: string; body: unknown } | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const canManage = access.data?.permissions?.includes("sales.manage") ?? false,
    canHandover = access.data?.permissions?.includes("sales.handover") ?? false;
  if (!canManage && !canHandover) return null;
  const completed = Boolean(value.completedAt),
    sold = Boolean(sale.completedAt || sale.lifecycle?.status === "sold");
  const message = saleHandoverMessage(sale, settings.identity.name);

  async function verify() {
    if (!active.current)
      throw new Error("Reopen the current sale before sharing.");
    const latest = await customFetch<{ sale: SaleWorkspaceRecord }>(
      `/api/sale-workspace/${sale.id}`,
    );
    if (!active.current || latest.sale.revision !== sale.revision)
      throw new Error(
        "The arrangements changed. Reload the sale and review them before sharing.",
      );
  }
  async function save(
    next: SaleWorkspaceFulfilment,
    handover?: { recipient: string; acknowledge: boolean },
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    attempt.current ??= {
      path: handover ? "handover" : "fulfilment",
      body: {
        requestId: crypto.randomUUID(),
        expectedRevision: sale.revision,
        ...(handover
          ? {
              recipient: handover.recipient,
              acknowledgeOutstanding: handover.acknowledge,
            }
          : { fulfilment: next }),
      },
    };
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(
        `/api/sale-workspace/${sale.id}/${attempt.current.path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attempt.current.body),
        },
      );
      attempt.current = null;
      if (!active.current) return;
      onSaved(result.sale);
      setForm(handoverDefaults(result.sale.draft));
      setEditing(false);
      setConfirm(false);
      setNotice(
        handover
          ? "Handover recorded."
          : "Arrangements saved. No customer message sent.",
      );
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["staff-notifications"] }),
      ]);
    } catch (cause) {
      if (!active.current) return;
      setError(
        (cause as { data?: { error?: string } })?.data?.error ||
          "This update could not be confirmed. Reload the sale and check before trying again.",
      );
      if ([400, 422].includes((cause as { status?: number })?.status || 0)) {
        attempt.current = null;
        setConflict(false);
      } else setConflict(true);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      const latest = await customFetch<{ sale: SaleWorkspaceRecord }>(
        `/api/sale-workspace/${sale.id}`,
      );
      if (!active.current) return;
      onSaved(latest.sale);
      setForm(handoverDefaults(latest.sale.draft));
      setEditing(false);
      setConflict(false);
      attempt.current = null;
      setError("");
      setConfirm(false);
    } catch {
      setError("Could not reload. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sale-handover" aria-label="Collection and delivery">
      <header>
        <div>
          <h3>Collection & delivery</h3>
          <p>
            {value.method === "delivery" ? "Delivery" : "Collection"} ·{" "}
            <strong>{saleHandoverStatus(value)}</strong>
          </p>
        </div>
        {canManage && !completed && (
          <Button
            variant="outline"
            disabled={busy || conflict}
            onClick={() => {
              setForm({
                ...value,
                recipient: value.recipient || sale.draft.customer,
                phone: value.phone || sale.draft.phone,
                address: value.address || sale.draft.address,
              });
              setEditing(!editing);
            }}
          >
            {" "}
            {editing ? "Cancel changes" : "Edit arrangements"}
          </Button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {conflict && (
        <Button variant="outline" disabled={busy} onClick={() => void reload()}>
          Reload latest sale
        </Button>
      )}
      {notice && <p role="status">{notice}</p>}
      {editing ? (
        <>
          <SaleHandoverFields
            draft={sale.draft}
            value={form}
            onChange={setForm}
            disabled={busy || conflict}
          />
          <Button
            disabled={busy || conflict}
            onClick={() =>
              void save({
                ...form,
                stage:
                  form.scheduledDate &&
                  (form.method !== "delivery" || form.address.trim())
                    ? "booked"
                    : "to_arrange",
              })
            }
          >
            Save arrangements
          </Button>
        </>
      ) : (
        <>
          <dl className="handover-summary">
            <div>
              <dt>Date</dt>
              <dd>
                {value.scheduledDate
                  ? new Date(
                      `${value.scheduledDate}T12:00:00Z`,
                    ).toLocaleDateString("en-GB", {
                      timeZone: "Europe/London",
                      dateStyle: "medium",
                    })
                  : "To arrange"}
                {value.timeWindow && ` · ${value.timeWindow} (UK time)`}
              </dd>
            </div>
            {value.method === "delivery" && (
              <div>
                <dt>Delivery address</dt>
                <dd>{value.address || "Not confirmed yet"}</dd>
              </div>
            )}
            <div>
              <dt>Recipient</dt>
              <dd>
                {value.recipient || sale.draft.customer}
                {value.phone && ` · ${value.phone}`}
              </dd>
            </div>
            {value.driver && (
              <div>
                <dt>Driver</dt>
                <dd>{value.driver}</dd>
              </div>
            )}
            {value.instructions && (
              <div>
                <dt>Staff notes</dt>
                <dd>{value.instructions}</dd>
              </div>
            )}
            {value.stage === "unsuccessful" && (
              <div>
                <dt>Delivery problem</dt>
                <dd>{value.failureReason}</dd>
              </div>
            )}
            {completed && (
              <div>
                <dt>Received by</dt>
                <dd>
                  {value.completedRecipient} ·{" "}
                  {new Date(value.completedAt!).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                  })}{" "}
                  (UK time)
                </dd>
              </div>
            )}
          </dl>
          <div className="handover-actions">
            {canManage && (
              <>
                <Button
                  variant="outline"
                  disabled={busy || conflict}
                  onClick={() => {
                    setEmailMessage(message);
                    setEmail(true);
                  }}
                >
                  Email confirmation
                </Button>
                <DirectWhatsApp
                  confirmedPhone={value.phone || sale.draft.phone}
                  label="WhatsApp confirmation"
                  disabled={busy || conflict}
                  customerPhone={value.phone || sale.draft.phone}
                  customerName={sale.draft.customer}
                  saleId={sale.id}
                  message={message}
                  beforeOpen={verify}
                  onEmailFallback={(body) => {
                    setEmailMessage(body || message);
                    setEmail(true);
                  }}
                />
              </>
            )}
            {!completed && sold && canHandover && (
              <Button
                disabled={
                  busy ||
                  conflict ||
                  !(value.recipient || sale.draft.customer).trim() ||
                  (value.method === "delivery" && !value.address.trim())
                }
                onClick={() => setConfirm(true)}
              >
                {value.method === "delivery"
                  ? "Mark delivered"
                  : "Mark collected"}
              </Button>
            )}
          </div>
          {!sold && !completed && (
            <p>
              Record handover after the sale is completed. Payments and the
              remaining balance are managed separately.
            </p>
          )}
        </>
      )}
      {confirm && (
        <HandoverDialog
          draft={sale.draft}
          balance={saleWorkspaceTotals(sale.draft, sale.payments).balance}
          busy={busy}
          problem={error}
          onClose={() => setConfirm(false)}
          onSave={(recipient, acknowledge) =>
            void save(value, { recipient, acknowledge })
          }
        />
      )}
      {email && (
        <InternalShareEmail
          open
          onOpenChange={setEmail}
          subject={`${value.method === "delivery" ? "Delivery" : "Collection"} details — ${settings.identity.name}`}
          message={emailMessage}
          saleId={sale.id}
          customerName={sale.draft.customer}
          customerEmail={sale.draft.email}
          customerPhone={value.phone || sale.draft.phone}
          verifyBeforePrepare={verify}
        />
      )}
    </section>
  );
}
