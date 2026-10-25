import { vehicleWatchHistoryId } from "./vehicle-watch-history";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  mailbox,
  replyConfiguration,
  retrieveReply,
} from "./customer-email-replies";
import { generateEnquiryReference } from "./enquiry-links";
type Executor = Pick<typeof db, "execute">;
/** Queue exact issued reply capabilities only. No marketplace parsing or subject matching. */
export async function acceptVehicleWatchReply(
  providerId: string,
  addresses: string[],
  executor: Executor = db,
) {
  if (!addresses.length) return;
  const rows = (
    await executor.execute(
      sql`SELECT r.* FROM vehicle_watch_reply_routes r JOIN dealerships d ON d.id=r.dealer_id WHERE r.reply_address IN (${sql.join(
        addresses.map((a) => sql`${a}`),
        sql`,`,
      )}) AND d.status='active'`,
    )
  ).rows.filter((r) => replyConfiguration(String(r.dealer_id)));
  if (rows.length !== 1) return;
  const r = rows[0]!;
  await executor.execute(
    sql`INSERT INTO vehicle_watch_reply_receipts(provider_id,route_id,dealer_id) VALUES(${providerId}::uuid,${String(r.id)}::uuid,${String(r.dealer_id)}) ON CONFLICT(provider_id) DO NOTHING`,
  );
}
/** Only a validated actual reply creates an Inbox enquiry. Signup and outgoing alerts never do. */
export async function processVehicleWatchReplies(
  transport: typeof fetch = fetch,
) {
  await db.execute(
    sql`UPDATE vehicle_watch_reply_receipts SET status='review',lease_until=NULL WHERE status='processing' AND attempts>=8 AND lease_until<=now()`,
  );
  for (let n = 0; n < 5; n++) {
    const lease = new Date(Date.now() + 60000);
    const receipt = (
      await db.execute(
        sql`WITH candidate AS(SELECT m.id FROM vehicle_watch_reply_receipts m JOIN dealerships d ON d.id=m.dealer_id WHERE d.status='active' AND m.attempts<8 AND ((m.status='pending' AND m.next_attempt_at<=now()) OR (m.status='processing' AND m.lease_until<=now())) ORDER BY m.next_attempt_at,m.id FOR UPDATE OF m SKIP LOCKED LIMIT 1) UPDATE vehicle_watch_reply_receipts r SET status='processing',attempts=attempts+1,lease_until=${lease} FROM candidate WHERE r.id=candidate.id RETURNING r.*`,
      )
    ).rows[0];
    if (!receipt) break;
    try {
      const dealer = String(receipt.dealer_id);
      if (!replyConfiguration(dealer))
        throw new Error("Reply processing unavailable.");
      const email = await retrieveReply(String(receipt.provider_id), transport);
      await db.transaction(async (tx) => {
        const held = (
          await tx.execute(
            sql`SELECT m.id FROM vehicle_watch_reply_receipts m JOIN dealerships d ON d.id=m.dealer_id WHERE m.id=${String(receipt.id)}::uuid AND m.dealer_id=${dealer} AND m.status='processing' AND m.lease_until=${lease} AND d.status='active' FOR UPDATE OF m`,
          )
        ).rows[0];
        if (!held) return;
        const route = (
          await tx.execute(
            sql`SELECT r.*,w.vehicle_id,v.title,v.website_title_override,v.source_price,v.website_price_override,d.subject,d.message,d.sent_at FROM vehicle_watch_reply_routes r JOIN vehicle_watches w ON w.id=r.watch_id AND w.dealer_id=r.dealer_id JOIN vehicles v ON v.id=w.vehicle_id AND v.dealer_id=w.dealer_id JOIN vehicle_watch_deliveries d ON d.id=r.delivery_id AND d.dealer_id=r.dealer_id WHERE r.id=${String(receipt.route_id)}::uuid AND r.dealer_id=${dealer} FOR UPDATE OF r`,
          )
        ).rows[0];
        if (!route) throw new Error("Watch reply route unavailable.");
        if (
          email.id !== String(receipt.provider_id) ||
          mailbox(email.from) !== route.recipient ||
          !email.to.map(mailbox).includes(String(route.reply_address)) ||
          email.authentication?.dmarc === "fail"
        ) {
          await tx.execute(
            sql`UPDATE vehicle_watch_reply_receipts SET status='review',lease_until=NULL WHERE id=${String(receipt.id)}::uuid`,
          );
          return;
        }
        let enquiry = route.enquiry_id ? String(route.enquiry_id) : null;
        if (!enquiry) {
          const existing = (
            await tx.execute(
              sql`SELECT id FROM enquiries WHERE dealer_id=${dealer} AND vehicle_id=${String(route.vehicle_id)}::uuid AND lower(email)=${String(route.recipient)} AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            )
          ).rows[0];
          enquiry = existing ? String(existing.id) : randomUUID();
          if (!existing) {
            await tx.execute(
              sql`INSERT INTO enquiries(id,dealer_id,reference,vehicle_id,vehicle_title,vehicle_price,type,status,customer_name,email,preferred_contact,message,source) VALUES(${enquiry}::uuid,${dealer},${generateEnquiryReference()},${String(route.vehicle_id)}::uuid,${String(route.website_title_override || route.title || "Vehicle")},${Number(route.website_price_override ?? route.source_price) || null},'general','new','Car watch customer',${String(route.recipient)},'email','Customer replied to a watched car update.','car_watch_reply')`,
            );
          }
          await tx.execute(
            sql`UPDATE vehicle_watch_reply_routes SET enquiry_id=${enquiry}::uuid WHERE dealer_id=${dealer} AND watch_id=${String(route.watch_id)}::uuid`,
          );
          const previous = (
            await tx.execute(
              sql`SELECT id,message,sent_at FROM vehicle_watch_deliveries WHERE dealer_id=${dealer} AND watch_id=${String(route.watch_id)}::uuid AND status='sent' ORDER BY sent_at,id`,
            )
          ).rows;
          for (const outgoing of previous)
            await tx.execute(
              sql`INSERT INTO enquiry_events(id,dealer_id,enquiry_id,kind,actor,summary,detail,occurred_at) VALUES(${vehicleWatchHistoryId(String(outgoing.id), enquiry)}::uuid,${dealer},${enquiry}::uuid,'conversation_logged','dealer','Car watch update emailed',${JSON.stringify({ channel: "email", direction: "outbound", note: String(outgoing.message), vehicleWatchDeliveryId: String(outgoing.id) })}::jsonb,${outgoing.sent_at ? new Date(String(outgoing.sent_at)) : new Date()}) ON CONFLICT(id) DO NOTHING`,
            );
        }
        const standard = (
          await tx.execute(
            sql`INSERT INTO enquiry_email_reply_routes(dealer_id,enquiry_id,send_key,reply_address,recipient) VALUES(${dealer},${enquiry}::uuid,${`vehicle-watch:${String(route.delivery_id)}`},${String(route.reply_address)},${String(route.recipient)}) ON CONFLICT(dealer_id,send_key) DO UPDATE SET enquiry_id=excluded.enquiry_id RETURNING id`,
          )
        ).rows[0]!;
        await tx.execute(
          sql`INSERT INTO enquiry_email_replies(provider_id,route_id,dealer_id,enquiry_id) VALUES(${String(receipt.provider_id)}::uuid,${String(standard.id)}::uuid,${dealer},${enquiry}::uuid) ON CONFLICT(provider_id) DO NOTHING`,
        );
        await tx.execute(
          sql`UPDATE vehicle_watch_reply_receipts SET status='received',lease_until=NULL WHERE id=${String(receipt.id)}::uuid`,
        );
      });
    } catch {
      await db.execute(
        sql`UPDATE vehicle_watch_reply_receipts SET status=${Number(receipt.attempts) >= 8 ? "review" : "pending"},lease_until=NULL,next_attempt_at=now()+interval '5 minutes' WHERE id=${String(receipt.id)}::uuid AND lease_until=${lease}`,
      );
    }
  }
}
