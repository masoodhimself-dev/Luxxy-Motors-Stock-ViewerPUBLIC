/** A durable recipient claim shared by Watch and enquiry price-update emails.
 * Claims survive outbox payload retention. No database connection is held while
 * contacting the provider; a crash or uncertain acceptance remains blocked.
 */
export type PriceUpdateQuery = (
  text: string,
  values?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export type PriceUpdateIdentity = {
  dealerId: string;
  vehicleId: string;
  changeKey: string;
  email: string;
};
const normalized = (identity: PriceUpdateIdentity) => ({
  ...identity,
  email: identity.email.trim().toLowerCase(),
});
export function watchPriceIdentity(
  event: { dealer_id: string; vehicle_id: string; change_key: string },
  email: string,
): PriceUpdateIdentity {
  return normalized({
    dealerId: event.dealer_id,
    vehicleId: event.vehicle_id,
    changeKey: event.change_key.replace(/^price:/, ""),
    email,
  });
}
export async function stockPriceIdentity(
  query: PriceUpdateQuery,
  dealerId: string,
  taskId: string,
  email: string,
): Promise<PriceUpdateIdentity | undefined> {
  const row = (
    await query(
      "SELECT vehicle_id,change_key FROM stock_change_tasks WHERE dealer_id=$1 AND id=$2 AND kind='price_drop'",
      [dealerId, taskId],
    )
  ).rows[0];
  return row
    ? normalized({
        dealerId,
        vehicleId: String(row.vehicle_id),
        changeKey: String(row.change_key),
        email,
      })
    : undefined;
}
export async function readPriceUpdateClaim(
  query: PriceUpdateQuery,
  identity: PriceUpdateIdentity,
) {
  const i = normalized(identity);
  return (
    await query(
      "SELECT source_key,status FROM price_update_recipient_claims WHERE dealer_id=$1 AND vehicle_id=$2 AND change_key=$3 AND email=$4",
      [i.dealerId, i.vehicleId, i.changeKey, i.email],
    )
  ).rows[0];
}
/** Call in the transaction that persists the outgoing delivery. Its unique key
 * serializes simultaneous Watch/enquiry approvals without an in-memory lock. */
export async function claimPriceUpdate(
  query: PriceUpdateQuery,
  identity: PriceUpdateIdentity,
  sourceKey: string,
) {
  const i = normalized(identity);
  await query(
    "INSERT INTO price_update_recipient_claims(dealer_id,vehicle_id,change_key,email,source_key,status) VALUES($1,$2,$3,$4,$5,'processing') ON CONFLICT(dealer_id,vehicle_id,change_key,email) DO NOTHING",
    [i.dealerId, i.vehicleId, i.changeKey, i.email, sourceKey],
  );
  return (await readPriceUpdateClaim(query, i))?.source_key === sourceKey;
}
/** Release only proven nonacceptance; never release a sent/uncertain claim. */
export async function finishPriceUpdate(
  query: PriceUpdateQuery,
  identity: PriceUpdateIdentity,
  sourceKey: string,
  status: "sent" | "uncertain" | "release",
) {
  const i = normalized(identity),
    values = [i.dealerId, i.vehicleId, i.changeKey, i.email, sourceKey];
  if (status === "release")
    await query(
      "DELETE FROM price_update_recipient_claims WHERE dealer_id=$1 AND vehicle_id=$2 AND change_key=$3 AND email=$4 AND source_key=$5 AND status='processing'",
      values,
    );
  else
    await query(
      "UPDATE price_update_recipient_claims SET status=$6,updated_at=now() WHERE dealer_id=$1 AND vehicle_id=$2 AND change_key=$3 AND email=$4 AND source_key=$5 AND status<>'sent'",
      [...values, status],
    );
}
