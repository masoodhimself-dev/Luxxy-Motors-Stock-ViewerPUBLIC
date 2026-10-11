import type { RequestHandler } from 'express';
import { deferredCustomerFeatureResponse } from '@workspace/vehicle-meta';

/** Block only new public intake, leaving staff records and payment recovery intact. */
export const enforceCustomerFeaturePolicy: RequestHandler = (req, res, next) => {
  const response = deferredCustomerFeatureResponse(req.path, req.method);
  if (!response) { next(); return; }
  res.set('Cache-Control', 'no-store').status(response.status).json(response.body);
};
