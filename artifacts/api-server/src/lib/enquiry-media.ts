import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { siteOrigin } from "./enquiry-links";
export class EnquiryMediaError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export async function enquiryMediaContext(
  enquiry: { id: string; dealerId: string; vehicleId: string | null },
  executor: typeof db = db,
) {
  const custom = (
    await executor.execute(
      sql`SELECT id,byte_size,width,height,created_at FROM enquiry_photos WHERE dealer_id=${enquiry.dealerId} AND enquiry_id=${enquiry.id}::uuid ORDER BY created_at,id LIMIT 2`,
    )
  ).rows;
  const images = enquiry.vehicleId
    ? (
        await executor.execute(
          sql`SELECT i.source_url,i.caption FROM vehicle_images i JOIN vehicles v ON v.id=i.vehicle_id WHERE v.id=${enquiry.vehicleId}::uuid AND v.dealer_id=${enquiry.dealerId} AND v.source_status='live' AND v.inventory_status IN ('available','reserved') AND v.archived_at IS NULL AND i.is_active ORDER BY i.sort_order,i.id LIMIT 100`,
        )
      ).rows
    : [];
  const vehiclePhotos = images.flatMap((row, index) => {
    try {
      const u = new URL(String(row.source_url));
      if (u.protocol !== "https:" || u.username || u.password) return [];
      return [
        {
          index,
          url: u.href,
          caption: row.caption ? String(row.caption) : null,
        },
      ];
    } catch {
      return [];
    }
  });
  const video = enquiry.vehicleId
    ? (
        await executor.execute(
          sql`SELECT x.id FROM vehicle_videos x JOIN vehicles v ON v.id=x.vehicle_id AND v.dealer_id=x.dealer_id WHERE x.dealer_id=${enquiry.dealerId} AND x.vehicle_id=${enquiry.vehicleId}::uuid AND x.published AND x.status='ready' AND v.source_status='live' AND v.inventory_status IN ('available','reserved') AND v.archived_at IS NULL LIMIT 1`,
        )
      ).rows[0]
    : null;
  return {
    customPhotos: custom.map((row) => ({
      id: String(row.id),
      byteSize: Number(row.byte_size),
      width: Number(row.width),
      height: Number(row.height),
      createdAt: new Date(String(row.created_at)).toISOString(),
      url: `/api/staff/enquiries/${enquiry.id}/photos/${row.id}`,
    })),
    vehiclePhotos,
    videoAvailable: Boolean(video),
    videoUrl: video
      ? `${siteOrigin()}/vehicle/${enquiry.vehicleId}?video=1#walkaround`
      : null,
    videoId: video ? String(video.id) : null,
  };
}
/** New empty media selectors must not invalidate previously approved request identities. */
export function mediaRequestIdentity<
  T extends {
    customPhotoIds?: string[];
    vehiclePhotoIndices?: number[];
    includeVideo?: boolean;
  },
>(value: T) {
  return {
    ...value,
    customPhotoIds: value.customPhotoIds?.length
      ? value.customPhotoIds
      : undefined,
    vehiclePhotoIndices: value.vehiclePhotoIndices?.length
      ? value.vehiclePhotoIndices
      : undefined,
    includeVideo: value.includeVideo || undefined,
  };
}
export async function selectedEnquiryMedia(
  enquiry: { id: string; dealerId: string; vehicleId: string | null },
  input: {
    customPhotoIds: string[];
    vehiclePhotoIndices: number[];
    includeVideo: boolean;
  },
  executor: typeof db = db,
) {
  const attachments: Array<{ id: string; filename: string; content: string }> =
      [],
    facts: Array<{ label: string; value: string }> = [];
  if (input.customPhotoIds.length) {
    const rows = (
      await executor.execute(
        sql`SELECT id,encode(jpeg,'hex') AS bytes FROM enquiry_photos WHERE dealer_id=${enquiry.dealerId} AND enquiry_id=${enquiry.id}::uuid AND id IN (${sql.join(
          input.customPhotoIds.map((id) => sql`${id}::uuid`),
          sql`,`,
        )})`,
      )
    ).rows;
    if (rows.length !== input.customPhotoIds.length)
      throw new EnquiryMediaError(
        "A selected enquiry photo was removed or belongs to another enquiry. Review the attachments.",
      );
    for (const [index, id] of input.customPhotoIds.entries()) {
      const row = rows.find((r) => r.id === id)!;
      attachments.push({
        id,
        filename: `enquiry-photo-${index + 1}.jpg`,
        content: Buffer.from(String(row.bytes), "hex").toString("base64"),
      });
    }
  }
  let videoId: string | null = null;
  if (input.vehiclePhotoIndices.length || input.includeVideo) {
    const context = await enquiryMediaContext(enquiry, executor);
    for (const index of input.vehiclePhotoIndices) {
      const image = context.vehiclePhotos.find((p) => p.index === index);
      if (!image)
        throw new EnquiryMediaError(
          "A selected car photo is no longer publicly available. Review the car photos.",
        );
      facts.push({ label: `Car photo ${index + 1}`, value: image.url });
    }
    if (input.includeVideo) {
      if (!context.videoAvailable || !context.videoUrl)
        throw new EnquiryMediaError(
          "This car has no published video available. Review the selection.",
        );
      facts.push({ label: "Car walkaround video", value: context.videoUrl });
      videoId = context.videoId;
    }
  }
  return { attachments, facts, videoId };
}
