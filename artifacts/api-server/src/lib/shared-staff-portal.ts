import { createClerkClient } from "@clerk/backend";
import { multiTenantEnabled, normaliseTenantHost } from "./tenant-context";

const sharedStaffDealerId = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function sharedStaffPortalConfig() {
  if (!multiTenantEnabled()) return null;
  const configuredHost = process.env.STAFF_PORTAL_HOST?.trim().toLowerCase();
  const host = normaliseTenantHost(configuredHost ?? "");
  const publishableKey = process.env.STAFF_PORTAL_CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = process.env.STAFF_PORTAL_CLERK_SECRET_KEY?.trim();
  const pilotDealerId = process.env.STAFF_PORTAL_PILOT_DEALER_ID?.trim();
  if (!host || host !== configuredHost ||
    host === normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? "") ||
    host === normaliseTenantHost(process.env.STOCK_IMPORT_API_HOST ?? "") ||
    !publishableKey || !/^pk_live_[A-Za-z0-9_+/=-]+$/.test(publishableKey) ||
    !secretKey || !/^sk_live_[A-Za-z0-9_+/=-]+$/.test(secretKey) ||
    !pilotDealerId || !sharedStaffDealerId.test(pilotDealerId)) return null;
  return { host, origin: `https://${host}`, publishableKey, secretKey, pilotDealerId };
}

export function sharedStaffPortalForHost(value: string | undefined) {
  const config = sharedStaffPortalConfig();
  return config && normaliseTenantHost(value ?? "") === config.host ? config : null;
}

export function sharedStaffPortalForDealer(dealerId: string) {
  const config = sharedStaffPortalConfig();
  return config?.pilotDealerId === dealerId ? config : null;
}

export function sharedStaffWorkspaceUrl(dealerId: string) {
  const config = sharedStaffPortalForDealer(dealerId);
  return config ? `${config.origin}/dealers/${dealerId}/portal` : null;
}

let client: { secretKey: string; publishableKey: string; value: ReturnType<typeof createClerkClient> } | undefined;
export function sharedStaffClerk(config: NonNullable<ReturnType<typeof sharedStaffPortalConfig>>) {
  if (client?.secretKey !== config.secretKey || client?.publishableKey !== config.publishableKey) {
    const { secretKey, publishableKey } = config;
    client = { secretKey, publishableKey, value: createClerkClient({ secretKey, publishableKey }) };
  }
  return client.value;
}
