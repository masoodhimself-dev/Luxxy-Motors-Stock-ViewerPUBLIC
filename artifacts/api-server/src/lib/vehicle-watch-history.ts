import { createHash } from "node:crypto";
/** Stable history id lets reply creation and post-send recovery share one event. */
export function vehicleWatchHistoryId(deliveryId: string, enquiryId: string) {
  const h = createHash("sha256")
    .update(`vehicle-watch-history:${deliveryId}:${enquiryId}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
