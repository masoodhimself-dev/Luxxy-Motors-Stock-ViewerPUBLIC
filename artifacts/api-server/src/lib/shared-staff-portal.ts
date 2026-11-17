import { createClerkClient } from "@clerk/backend";
import { multiTenantEnabled, normaliseTenantHost } from "./tenant-context";

const sharedStaffDealerId = /^[a-z0-9][a-z0-9-]{1,62}$/;
export type SharedStaffDealerScope = readonly string[] | "*";

function configuredDealers(): SharedStaffDealerScope | null {
  const rollout = process.env.STAFF_PORTAL_DEALER_IDS?.trim();
  if (rollout === "*") return "*";
  const ids = rollout
    ? rollout.split(",").map((id) => id.trim())
    : [process.env.STAFF_PORTAL_PILOT_DEALER_ID?.trim() ?? ""];
  return ids.every((id) => sharedStaffDealerId.test(id)) ? [...new Set(ids)] : null;
}

export function sharedStaffScopeIncludes(dealerIds: SharedStaffDealerScope, dealerId: string) {
  return sharedStaffDealerId.test(dealerId) && (dealerIds === "*" || dealerIds.includes(dealerId));
}

export function sharedStaffPortalConfig() {
  if (!multiTenantEnabled()) return null;
  const configuredHost = process.env.STAFF_PORTAL_HOST?.trim().toLowerCase();
  const host = normaliseTenantHost(configuredHost ?? "");
  const publishableKey = process.env.STAFF_PORTAL_CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = process.env.STAFF_PORTAL_CLERK_SECRET_KEY?.trim();
  const dealerIds = configuredDealers();
  if (!host || host !== configuredHost ||
    host === normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? "") ||
    host === normaliseTenantHost(process.env.STOCK_IMPORT_API_HOST ?? "") ||
    !publishableKey || !/^pk_live_[A-Za-z0-9_+/=-]+$/.test(publishableKey) ||
    !secretKey || !/^sk_live_[A-Za-z0-9_+/=-]+$/.test(secretKey) ||
    !dealerIds) return null;
  return { host, origin: `https://${host}`, publishableKey, secretKey, dealerIds };
}

export function sharedStaffPortalForHost(value: string | undefined) {
  const config = sharedStaffPortalConfig();
  return config && normaliseTenantHost(value ?? "") === config.host ? config : null;
}

export function sharedStaffPortalForDealer(dealerId: string) {
  const config = sharedStaffPortalConfig();
  return config && sharedStaffScopeIncludes(config.dealerIds, dealerId) ? config : null;
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
