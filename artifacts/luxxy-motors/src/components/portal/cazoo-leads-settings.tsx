import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "./portal-ui";

type ForwardingSettings = { enabled: boolean; recipient: string | null; canManage: boolean };
type ForwardingInput = Omit<ForwardingSettings, "canManage">;
type Receipt = {
  id: string;
  status: string;
  errorCode: string | null;
  subject: string | null;
  enquiryId: string | null;
  draftStatus: string;
  automaticReplyStatus?: "sending" | "sent" | "failed" | "unknown" | null;
  forwardStatus?: "pending" | "sending" | "sent" | "failed" | "unknown" | "cancelled" | null;
  canForward?: boolean;
  receivedAt: string;
  reviewText: string | null;
};
type Connection = {
  enabled: boolean;
  mailbox: string | null;
  receipts: Receipt[];
  ownerTest?: { email: string; expiresAt: string } | null;
  automation?: { automaticDraftsEnabled: boolean; automaticRepliesEnabled: boolean };
  forwarding?: ForwardingSettings;
};
const cazooLeadsKey = ["cazoo-leads"] as const;
const reasons: Record<string, string> = {
  owner_test: "Owner test — the original customer’s contact details were not imported.",
  owner_test_format: "For a test, forward one original Cazoo lead, or use subject: Enquiry - Audi A5 MW62VLP - Test and write your question in the message.",
  sender_not_cazoo: "Sender is not the expected Cazoo address.",
  sender_authentication_unverified:
    "The sender could not be authenticated. Check the original email.",
  unrecognised_subject: "The subject has a different format.",
  missing_or_ambiguous_reference:
    "A unique Cazoo reference could not be found.",
  unrecognised_message_layout:
    "The customer details or message could not be separated safely.",
  missing_or_ambiguous_customer_email: "The customer's email needs checking.",
  customer_email_missing: "Cazoo did not supply a customer email. Check the contact details in the Inbox.",
  invalid_customer_phone: "The customer's phone number needs checking.",
  ambiguous_customer_phone: "More than one phone number was found.",
  invalid_customer_name: "The customer's name needs checking.",
  invalid_customer_message: "The customer message needs checking.",
  recipient_mismatch: "The delivery address did not match this connection.",
  retrieval_failed: "The original email could not be retrieved.",
  vehicle_not_matched:
    "Check the car registration in the enquiry before replying.",
  mailbox_not_connected: "The mailbox connection has changed.",
};
const automaticReplyLabels = {
  sending: "Automatic availability reply queued.",
  sent: "Automatic availability reply sent.",
  failed: "Automatic reply stopped. Open the enquiry to reply.",
  unknown: "Automatic delivery is unconfirmed. Check the enquiry before replying.",
};
const forwardingLabels = {
  pending: "Forwarding queued.",
  sending: "Forwarding in progress.",
  sent: "Forwarded to your dealership.",
  failed: "Could not forward this email.",
  unknown: "Forwarding could not be confirmed.",
  cancelled: "Forwarding stopped.",
};

function CazooForwardingSettings({ settings }: { settings: ForwardingSettings }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<ForwardingInput | null>(null);
  const enabled = draft?.enabled ?? settings.enabled;
  const address = (draft ? draft.recipient : settings.recipient) ?? "";
  const recipient = enabled ? address.trim() || null : null;
  const dirty = enabled !== settings.enabled || (enabled && recipient !== settings.recipient);
  const save = useMutation({
    mutationFn: (next: ForwardingInput) => customFetch<ForwardingSettings>("/api/staff/cazoo-leads/forwarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }),
    onSuccess: async (forwarding) => {
      await client.cancelQueries({ queryKey: cazooLeadsKey });
      client.setQueryData<Connection>(cazooLeadsKey, (current) => current ? { ...current, forwarding } : current);
      setDraft(null);
    },
  });
  function change(next: ForwardingInput) {
    save.reset();
    setDraft(next);
  }

  return (
    <form
      className="admin-card my-3 grid gap-3"
      aria-label="Cazoo enquiry forwarding"
      data-settings-dirty={dirty}
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !save.isPending && (!enabled || recipient)) save.mutate({ enabled, recipient });
      }}
    >
      <div>
        <h3>Forward enquiries</h3>
        <p className="text-sm text-muted-foreground">
          Send a copy of new Cazoo enquiries to your dealership email. They’ll still appear in the Inbox.
        </p>
      </div>
      <label className="flex min-h-11 items-center justify-between gap-4 text-sm font-semibold">
        <span>Forward new Cazoo enquiries</span>
        <Switch
          checked={enabled}
          disabled={save.isPending}
          onCheckedChange={(next) => change({ enabled: next, recipient: address })}
        />
      </label>
      {enabled && (
        <label className="grid gap-2 text-sm font-semibold">
          Destination email
          <Input
            type="email"
            value={address}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            required
            disabled={save.isPending}
            onChange={(event) => change({ enabled, recipient: event.currentTarget.value })}
          />
        </label>
      )}
      <Button type="submit" className="min-h-11 justify-self-start" disabled={!dirty || save.isPending || (enabled && !recipient)}>
        {save.isPending ? "Saving…" : "Save forwarding"}
      </Button>
      {save.isError && <p role="alert">Could not save forwarding. Check the address and try again.</p>}
      {save.isSuccess && <p role="status">Forwarding turned {save.data.enabled ? "on" : "off"}.</p>}
    </form>
  );
}

export function CazooLeadsSettings() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: cazooLeadsKey,
    enabled: open,
    retry: false,
    queryFn: ({ signal }) =>
      customFetch<Connection>("/api/staff/cazoo-leads", { signal }),
  });
  const retry = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/staff/cazoo-leads/${id}/retry`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: cazooLeadsKey }),
  });
  const forward = useMutation({
    mutationFn: (id: string) => customFetch(`/api/staff/cazoo-leads/${id}/forward`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: cazooLeadsKey }),
  });
  return (
    <details
      className="settings-section"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Cazoo enquiries</summary>
      {open && (
        <div>
          <p>Cazoo leads appear in your Inbox.</p>
          {query.isPending && <p role="status">Loading Cazoo connection…</p>}
          {query.isError && (
            <p role="alert">
              Cazoo connection could not load. Please try again.
            </p>
          )}
          {query.data && (
            <>
              <p>
                <strong>
                  {query.data.enabled && query.data.mailbox
                    ? "Receiving connected"
                    : "Not connected yet"}
                </strong>
              </p>
              {query.data.mailbox ? (
                <p>
                  Delivery address:{" "}
                  <strong style={{ overflowWrap: "anywhere" }}>
                    {query.data.mailbox}
                  </strong>
                </p>
              ) : (
                <p>
                  Ask Dealer OS to connect your dedicated Cazoo delivery
                  address. Your usual email address stays unchanged.
                </p>
              )}
              {query.data.ownerTest && <p role="status">Owner testing is enabled for <strong>{query.data.ownerTest.email}</strong> until {formatDateTime(query.data.ownerTest.expiresAt)}. Test replies are addressed to this email only.</p>}
              {query.data.automation?.automaticDraftsEnabled === true ? (
                <p>
                  {query.data.automation.automaticRepliesEnabled === true
                    ? "Automatic first replies are on for eligible Cazoo enquiries. Staff handle any follow-up."
                    : "AI prepares drafts for you to check and send."}
                </p>
              ) : query.data.automation ? (
                <p>Automatic drafting is off. You can reply in the Inbox.</p>
              ) : null}
              {query.data.forwarding?.canManage === true && (
                <CazooForwardingSettings settings={query.data.forwarding} />
              )}
              <p>
                {query.data.receipts.length
                  ? "Recent Cazoo emails"
                  : "No Cazoo emails received yet."}
              </p>
              {query.data.receipts.map((receipt) => (
                <article
                  key={receipt.id}
                  className="admin-card"
                  style={{ marginBlock: 12 }}
                >
                  <strong>{receipt.subject || "Incoming Cazoo email"}</strong>
                  <p>
                    {formatDateTime(receipt.receivedAt)} ·{" "}
                    {receipt.status === "imported"
                      ? "Added to Inbox"
                      : receipt.status === "review"
                        ? "Needs checking"
                        : receipt.status === "duplicate"
                          ? "Duplicate — no extra enquiry"
                          : "Processing"}
                  </p>
                  {receipt.errorCode && (
                    <p>
                      {reasons[receipt.errorCode] ||
                        "This email needs checking."}
                    </p>
                  )}
                  {receipt.status === "imported" && (
                    <p>
                      {receipt.automaticReplyStatus
                        ? automaticReplyLabels[receipt.automaticReplyStatus]
                        : receipt.draftStatus === "ready"
                        ? "AI draft ready — review before sending."
                        : receipt.draftStatus === "pending" ||
                            receipt.draftStatus === "generating"
                          ? "Preparing AI draft…"
                          : "No saved draft. Open the enquiry to see the conversation."}
                    </p>
                  )}
                  {receipt.forwardStatus && <p>{forwardingLabels[receipt.forwardStatus]}</p>}
                  {query.data.forwarding?.canManage === true && receipt.canForward === true && (
                    <Button
                      variant="outline"
                      disabled={forward.isPending || (forward.isSuccess && forward.variables === receipt.id)}
                      onClick={() => forward.mutate(receipt.id)}
                    >
                      {forward.isPending && forward.variables === receipt.id ? "Requesting…" : "Forward to owner"}
                    </Button>
                  )}
                  {forward.variables === receipt.id && forward.isError && (
                    <p role="alert">Could not forward this enquiry. Try again.</p>
                  )}
                  {forward.variables === receipt.id && forward.isSuccess && (
                    <p role="status">Forwarding requested.</p>
                  )}
                  {receipt.enquiryId && (
                    <a
                      href={`/portal?section=notifications&workView=customers&enquiryId=${receipt.enquiryId}`}
                    >
                      Open enquiry
                    </a>
                  )}
                  {receipt.status === "review" && (
                    <>
                      {receipt.reviewText && (
                        <details>
                          <summary>View email text</summary>
                          <pre
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                              font: "inherit",
                              maxHeight: 240,
                              overflow: "auto",
                            }}
                          >
                            {receipt.reviewText}
                          </pre>
                        </details>
                      )}
                      <Button
                        variant="outline"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(receipt.id)}
                      >
                        Retry import
                      </Button>
                    </>
                  )}
                </article>
              ))}
            </>
          )}
          {retry.isError && (
            <p role="alert">The retry could not be queued. Please try again.</p>
          )}
          {retry.isSuccess && (
            <p role="status">Email queued for another check.</p>
          )}
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh connection
          </Button>
        </div>
      )}
    </details>
  );
}
