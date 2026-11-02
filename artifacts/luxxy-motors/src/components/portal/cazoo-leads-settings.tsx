import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "./portal-ui";

type Receipt = {
  id: string;
  status: string;
  errorCode: string | null;
  subject: string | null;
  enquiryId: string | null;
  draftStatus: string;
  receivedAt: string;
  reviewText: string | null;
};
type Connection = {
  enabled: boolean;
  mailbox: string | null;
  receipts: Receipt[];
  ownerTest?: { email: string; expiresAt: string } | null;
};
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
export function CazooLeadsSettings() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["cazoo-leads"],
    enabled: open,
    retry: false,
    queryFn: ({ signal }) =>
      customFetch<Connection>("/api/staff/cazoo-leads", { signal }),
  });
  const retry = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/staff/cazoo-leads/${id}/retry`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["cazoo-leads"] }),
  });
  return (
    <details
      className="settings-section"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Cazoo enquiries</summary>
      {open && (
        <div>
          <p>
            Cazoo leads appear in your Inbox. AI replies are saved as drafts for
            you to check and send.
          </p>
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
                      {receipt.draftStatus === "ready"
                        ? "AI draft ready — review before sending."
                        : receipt.draftStatus === "pending" ||
                            receipt.draftStatus === "generating"
                          ? "Preparing AI draft…"
                          : "No automatic draft. You can reply or use AI in the Inbox."}
                    </p>
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
