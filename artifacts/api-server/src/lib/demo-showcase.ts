import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, dealerDemosTable, dealerSettingsTable, dealershipsTable } from '@workspace/db';
import { isWebsiteTemplateId, type WebsiteTemplateId } from '@workspace/vehicle-meta/website-templates';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod/v4';
import { normaliseTenantHost } from './tenant-context';

const dealerIdPattern = /^[a-z0-9][a-z0-9-]{1,62}$/;
const templates = z.array(z.custom<WebsiteTemplateId>(isWebsiteTemplateId)).min(1).max(3)
  .refine(ids => new Set(ids).size === ids.length);
const claimsSchema = z.tuple([z.string().regex(dealerIdPattern), templates, z.number().int().positive()]);
const signatureSize = 32;
const msPerDay = 86_400_000;

export const demoShowcaseSelection = z.object({
  templates,
  days: z.union([z.literal(1), z.literal(7), z.literal(14)]),
}).strict();

function sign(payload: Buffer) {
  const secret = process.env.SESSION_SECRET?.trim();
  const host = normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? '');
  if (!secret || !host) return null;
  return createHmac('sha256', secret).update(`dealeros:demo-showcase:v1:${host}\0`).update(payload).digest();
}

export function makeDemoShowcaseLink(dealerId: string, input: z.infer<typeof demoShowcaseSelection>, demoExpiry: Date) {
  const expiresAt = Math.min(demoExpiry.getTime(), Date.now() + input.days * msPerDay);
  const payload = Buffer.from(JSON.stringify([dealerId, input.templates, expiresAt]));
  const signature = sign(payload);
  if (!signature) return null;
  const token = Buffer.concat([payload, signature]).toString('base64url');
  return { path: `/showcase/${token}`, expiresAt: new Date(expiresAt).toISOString() };
}

export function readDemoShowcaseToken(token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{45,320}$/.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length <= signatureSize || bytes.toString('base64url') !== token) return null;
  const payload = bytes.subarray(0, -signatureSize);
  const signature = sign(payload);
  if (!signature || !timingSafeEqual(signature, bytes.subarray(-signatureSize))) return null;
  try {
    const parsed = claimsSchema.safeParse(JSON.parse(payload.toString('utf8')));
    if (!parsed.success) return null;
    const [dealerId, templates, expiresAt] = parsed.data;
    return { dealerId, templates, expiresAt };
  } catch {
    return null;
  }
}

export async function demoShowcaseTarget(dealerId: string) {
  if (!dealerIdPattern.test(dealerId)) return undefined;
  const [target] = await db.select({
    dealerId: dealershipsTable.id,
    name: dealershipsTable.name,
    canonicalOrigin: dealershipsTable.canonicalOrigin,
    platform: dealershipsTable.stockPlatform,
    retailerId: dealershipsTable.retailerId,
    sourceUrl: dealershipsTable.sourceUrl,
    expiresAt: dealerDemosTable.expiresAt,
  }).from(dealershipsTable)
    .innerJoin(dealerDemosTable, and(eq(dealerDemosTable.dealerId, dealershipsTable.id), isNull(dealerDemosTable.convertedAt)))
    .innerJoin(dealerSettingsTable, eq(dealerSettingsTable.dealerId, dealershipsTable.id))
    .where(and(eq(dealershipsTable.id, dealerId), inArray(dealershipsTable.status, ['draft', 'active'])));
  return target;
}
