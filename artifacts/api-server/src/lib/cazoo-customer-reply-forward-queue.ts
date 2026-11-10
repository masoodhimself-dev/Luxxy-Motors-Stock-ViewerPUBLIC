import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import { cazooCustomerReplyLeadJoins } from "./cazoo-customer-reply-lineage";
import { cazooLeadForwardRecipient } from "./cazoo-lead-forwarding";
import { cazooLeadMailboxes, cazooLeadsEnabled } from "./cazoo-leads";
import { replyConfiguration } from "./customer-email-replies";
import { emailRetryWindowMs } from "./email-outbox";

/** Called in the verified inbound transaction. Message contents stay in the Inbox receipt. */
export async function queueCazooCustomerReplyForward(
  input: { replyId: string; dealerId: string; originEnquiryId: string },
  executor: Pick<typeof db, "execute">,
) {
  if (!cazooLeadsEnabled()) return;
  const { replyId, dealerId, originEnquiryId } = input;
  const mailboxes = cazooLeadMailboxes();
  const leadMailbox = mailboxes[dealerId];
  const replies = replyConfiguration(dealerId);
  if (!leadMailbox || !replies) return;

  const settings = (await executor.execute(sql`
    SELECT recipient FROM cazoo_lead_forwarding_settings
    WHERE dealer_id=${dealerId} AND enabled AND forward_replies
  `)).rows[0];
  const recipient = cazooLeadForwardRecipient(settings?.recipient, Object.values(mailboxes));
  if (!recipient || recipient.endsWith(`@${replies.domain}`)) return;

  await executor.execute(sql`
    INSERT INTO cazoo_customer_reply_forwards(reply_id,dealer_id,lead_receipt_id,recipient,retry_deadline)
    SELECT m.id,m.dealer_id,r.id,${recipient},${new Date(Date.now() + emailRetryWindowMs)}
    FROM enquiry_email_replies m
    JOIN enquiry_email_reply_routes route ON route.id=m.route_id AND route.dealer_id=m.dealer_id
    ${cazooCustomerReplyLeadJoins}
    JOIN dealerships d ON d.id=m.dealer_id
    JOIN cazoo_lead_forwarding_settings s ON s.dealer_id=m.dealer_id
    WHERE m.id=${replyId}::uuid AND m.dealer_id=${dealerId} AND m.status='received'
      AND route.enquiry_id=${originEnquiryId}::uuid AND m.sender=route.recipient AND m.sender<>${recipient}
      AND coalesce(lead.merged_into_id,lead.id)=m.enquiry_id
      AND r.status='imported' AND r.error_code IS DISTINCT FROM 'owner_test' AND r.mailbox=${leadMailbox}
      AND s.enabled AND s.forward_replies AND s.recipient=${recipient}
      AND d.status='active' AND d.stock_platform='cazoo'
      AND NOT EXISTS (SELECT 1 FROM dealer_demos WHERE dealer_id=d.id AND converted_at IS NULL)
    ORDER BY (r.enquiry_id=route.enquiry_id) DESC,r.received_at DESC,r.id DESC LIMIT 1
    ON CONFLICT(reply_id) DO NOTHING
  `);
}
