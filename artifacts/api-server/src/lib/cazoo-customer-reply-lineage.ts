import { sql } from "drizzle-orm";

/** Resolve a Cazoo origin from the reply route or an explicitly targeted staff send. */
export const cazooCustomerReplyLeadJoins = sql`
  JOIN enquiries route_enquiry ON route_enquiry.id=route.enquiry_id AND route_enquiry.dealer_id=m.dealer_id
  JOIN cazoo_lead_receipts r ON r.dealer_id=m.dealer_id AND (
    r.enquiry_id=route.enquiry_id OR r.id=(
      SELECT prior.lead_receipt_id
      FROM email_outbox outgoing
      JOIN cazoo_customer_reply_forwards prior ON prior.dealer_id=outgoing.dealer_id
        AND prior.reply_id=CASE WHEN outgoing.validation->>'enquiryReplyId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
          THEN (outgoing.validation->>'enquiryReplyId')::uuid END
      JOIN enquiry_email_replies previous ON previous.id=prior.reply_id AND previous.dealer_id=prior.dealer_id
      JOIN enquiries previous_enquiry ON previous_enquiry.id=previous.enquiry_id AND previous_enquiry.dealer_id=previous.dealer_id
      WHERE outgoing.dealer_id=m.dealer_id AND outgoing.send_key=route.send_key AND outgoing.enquiry_id=route.enquiry_id
        AND outgoing.kind='staff' AND outgoing.delivery_id IS NOT NULL AND outgoing.status IN ('sending','sent') AND outgoing.attempts>0
        AND prior.status IN ('pending','sending','sent') AND previous.status='received' AND previous.error_code IS NULL
        AND previous.sender=route.recipient
        AND coalesce(previous_enquiry.merged_into_id,previous_enquiry.id)=coalesce(route_enquiry.merged_into_id,route_enquiry.id)
    )
  )
  JOIN enquiries lead ON lead.id=r.enquiry_id AND lead.dealer_id=m.dealer_id AND lead.source='cazoo'
`;
