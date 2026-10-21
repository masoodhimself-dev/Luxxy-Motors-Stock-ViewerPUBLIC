import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@workspace/db';
import { currentDealerId } from './tenant-context';
import { siteOrigin } from './enquiry-links';
import { WebsiteAssetError, websiteAssetLimits, type NormalisedWebsiteImage, type WebsiteAssetMime } from './website-asset-image';

type StoredAsset = { id: string; mime_type: WebsiteAssetMime; byte_size: number; width: number; height: number; request_hash?: string; digest?: string; bytes?: string };
export function publicWebsiteAssetPath(id: string) { return `/api/website-assets/${id}`; }
function publicMetadata(asset: StoredAsset, replayed: boolean) {
  return { id: asset.id, url: `${siteOrigin()}${publicWebsiteAssetPath(asset.id)}`, mimeType: asset.mime_type, byteSize: Number(asset.byte_size), width: Number(asset.width), height: Number(asset.height), replayed };
}

/** Uploading creates an immutable public asset only; it never changes published settings. */
export async function saveDealerWebsiteAsset(requestId: string, image: NormalisedWebsiteImage, uploadedBy: string) {
  const dealer = currentDealerId();
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`website-assets:${dealer}`}))`);
    const prior = (await tx.execute(sql`SELECT id,mime_type,byte_size,width,height,request_hash FROM dealer_website_assets WHERE dealer_id=${dealer} AND request_id=${requestId}::uuid`)).rows[0] as StoredAsset | undefined;
    if (prior) {
      if (prior.request_hash !== image.requestHash) throw new WebsiteAssetError('This upload request was already used for another image. Choose the image again.', 409, 'WEBSITE_IMAGE_REQUEST_CONFLICT');
      return publicMetadata(prior, true);
    }
    const quota = (await tx.execute(sql`SELECT count(*)::integer AS count,coalesce(sum(byte_size),0)::bigint AS bytes FROM dealer_website_assets WHERE dealer_id=${dealer}`)).rows[0];
    if (Number(quota?.count) >= websiteAssetLimits.dealerCount || Number(quota?.bytes) + image.bytes.length > websiteAssetLimits.dealerBytes) {
      throw new WebsiteAssetError('This dealership has reached its website image storage allowance. Contact the platform operator before adding more images.', 409, 'WEBSITE_IMAGE_QUOTA');
    }
    const id = randomUUID();
    const stored = (await tx.execute(sql`INSERT INTO dealer_website_assets(id,dealer_id,request_id,request_hash,bytes,mime_type,byte_size,width,height,digest,uploaded_by) VALUES(${id}::uuid,${dealer},${requestId}::uuid,${image.requestHash},decode(${image.bytes.toString('hex')},'hex'),${image.mimeType},${image.bytes.length},${image.width},${image.height},${image.digest},${uploadedBy}) RETURNING id,mime_type,byte_size,width,height`)).rows[0] as StoredAsset;
    return publicMetadata(stored, false);
  });
}

/** Both predicates are required even though IDs are random and public URLs are unguessable. */
export async function readDealerWebsiteAsset(id: string) {
  const result = await db.execute(sql`SELECT id,mime_type,byte_size,width,height,digest,encode(bytes,'hex') AS bytes FROM dealer_website_assets WHERE dealer_id=${currentDealerId()} AND id=${id}::uuid`);
  const row = result.rows[0] as StoredAsset | undefined;
  return row ? { mimeType: row.mime_type, bytes: Buffer.from(row.bytes!, 'hex'), digest: row.digest!, byteSize: Number(row.byte_size) } : null;
}
