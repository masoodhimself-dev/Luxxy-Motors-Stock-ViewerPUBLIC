import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { canonicalJson } from './stock-payload-hash';

/** Hash the exact public representation, never an import time or private row revision. */
export function stockRepresentation(dealerId: string, source: string, body: unknown) {
  const json = canonicalJson(body);
  const digest = createHash('sha256').update(JSON.stringify(['stock-v1', dealerId, source])).update('\n').update(json).digest('hex');
  return { json, etag: `"stock-v1-${digest}"` };
}

/** GET validators use weak comparison, including a browser's list of known versions. */
function matches(ifNoneMatch: string | undefined, etag: string) {
  return Boolean(ifNoneMatch?.split(',').some(candidate => {
    const value = candidate.trim();
    return value === '*' || value.replace(/^W\//, '') === etag;
  }));
}

/** Revalidation saves transfer bytes without storing stock in shared intermediary caches. */
export function sendConditionalStock(req: Request, res: Response, scope: { dealerId: string; source: string }, body: unknown) {
  const representation = stockRepresentation(scope.dealerId, scope.source, body);
  // Demo middleware's privacy/expiry policy takes precedence. The frontend can
  // still explicitly validate its in-memory copy without a persistent HTTP cache.
  if (!/\bno-store\b/i.test(String(res.getHeader('Cache-Control') ?? ''))) {
    res.set('Cache-Control', 'private, no-cache');
  }
  res.set('ETag', representation.etag);
  if (matches(req.get('If-None-Match'), representation.etag)) {
    res.status(304).end();
    return;
  }
  res.type('application/json').send(representation.json);
}
