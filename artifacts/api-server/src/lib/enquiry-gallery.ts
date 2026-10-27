import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
export class EnquiryGalleryError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
/** Share only already-public stock gallery URLs; no temporary uploads or video access. */
export async function enquiryGalleryContext(
  enquiry: { dealerId: string; vehicleId: string | null },
  executor: typeof db = db,
) {
  const images = enquiry.vehicleId
    ? (
        await executor.execute(
          sql`SELECT i.source_url,i.caption FROM vehicle_images i JOIN vehicles v ON v.id=i.vehicle_id WHERE v.id=${enquiry.vehicleId}::uuid AND v.dealer_id=${enquiry.dealerId} AND v.source_status='live' AND v.inventory_status IN ('available','reserved') AND v.archived_at IS NULL AND i.is_active ORDER BY i.sort_order,i.id LIMIT 100`,
        )
      ).rows
    : [];
  return {
    vehiclePhotos: images.flatMap((row, index) => {
      try {
        const url = new URL(String(row.source_url));
        return url.protocol === "https:" && !url.username && !url.password
          ? [
              {
                index,
                url: url.href,
                caption: row.caption ? String(row.caption) : null,
              },
            ]
          : [];
      } catch {
        return [];
      }
    }),
  };
}
export async function selectedEnquiryGallery(
  enquiry: { dealerId: string; vehicleId: string | null },
  input: { vehiclePhotoIndices: number[] },
  executor: typeof db = db,
) {
  if (!input.vehiclePhotoIndices.length) return [];
  const context = await enquiryGalleryContext(enquiry, executor);
  return input.vehiclePhotoIndices.map((index) => {
    const image = context.vehiclePhotos.find((item) => item.index === index);
    if (!image)
      throw new EnquiryGalleryError(
        "A selected car photo is no longer publicly available. Review the car photos.",
      );
    return { label: `Car photo ${index + 1}`, value: image.url };
  });
}
