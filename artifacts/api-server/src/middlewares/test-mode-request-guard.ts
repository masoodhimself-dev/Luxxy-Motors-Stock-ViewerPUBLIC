import type { RequestHandler } from 'express';

/** A request explicitly marked as a test cannot mutate live APIs. This is an
 * extra guard for the test tab, not a lock on other tabs or unmarked requests. */
export const testModeRequestGuard:RequestHandler = (req,res,next) => {
  const marker=req.get('x-luxxy-test-session');
  if(!marker || ['GET','HEAD','OPTIONS'].includes(req.method)) {next();return;}
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(marker)) {res.status(403).json({error:'Invalid test workspace marker.'});return;}
  // This is a deliberate owner-controlled persistent setting; the endpoint
  // performs its own staff authorization and validation.
  if(req.method==='PUT' && req.path==='/test-email-settings') {next();return;}
  const prefix=`/sales-test/sessions/${marker}`;
  if(req.path===prefix || req.path.startsWith(`${prefix}/`) && /^[a-zA-Z0-9/_-]+$/.test(req.path.slice(prefix.length+1))) {next();return;}
  res.status(403).json({error:'This action is unavailable in test mode. Live records were not changed.'});
};
