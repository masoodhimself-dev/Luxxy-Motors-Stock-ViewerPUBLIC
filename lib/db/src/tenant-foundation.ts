import { sql } from "drizzle-orm";

export const LUXXY_TENANT = Object.freeze({
  organizationId: "10000000-0000-4000-8000-000000000001",
  dealerId: "20000000-0000-4000-8000-000000000001",
  domainId: "30000000-0000-4000-8000-000000000001",
  autoTraderProviderId: "40000000-0000-4000-8000-000000000001",
  autoTraderIntegrationId: "50000000-0000-4000-8000-000000000001",
  organizationSlug: "luxxy-motors",
  dealerSlug: "luxxy-motors",
  legacyDealerId: "luxxy-motors",
  productionHostname: "luxxymotors.co.uk",
  autoTraderProviderKey: "autotrader",
  autoTraderRetailerId: "10040438",
} as const);

export type TenantContext = Readonly<{
  organizationId: string;
  dealerId: string;
  dealerIntegrationId: string;
  legacyDealerId: string;
  source: string;
}>;

export const LUXXY_AUTOTRADER_CONTEXT: TenantContext = Object.freeze({
  organizationId: LUXXY_TENANT.organizationId,
  dealerId: LUXXY_TENANT.dealerId,
  dealerIntegrationId: LUXXY_TENANT.autoTraderIntegrationId,
  legacyDealerId: LUXXY_TENANT.legacyDealerId,
  source: "autotrader",
});

/**
 * Rerunnable compatibility seed/backfill. It deliberately only maps legacy
 * Luxxy rows and never writes the legacy dealer_id or source columns.
 */
export async function backfillLuxxyTenant(database: {
  transaction<T>(callback: (tx: { execute(query: unknown): Promise<unknown> }) => Promise<T>): Promise<T>;
}): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.execute(sql`
      insert into organizations (id, slug, name)
      values (${LUXXY_TENANT.organizationId}::uuid, ${LUXXY_TENANT.organizationSlug}, 'Luxxy Motors')
      on conflict (id) do update set slug = excluded.slug, name = excluded.name
    `);
    await tx.execute(sql`
      insert into dealers (id, organization_id, slug, name, legacy_dealer_id, timezone, currency, status)
      values (${LUXXY_TENANT.dealerId}::uuid, ${LUXXY_TENANT.organizationId}::uuid,
        ${LUXXY_TENANT.dealerSlug}, 'Luxxy Motors', ${LUXXY_TENANT.legacyDealerId},
        'Europe/London', 'GBP', 'active')
      on conflict (id) do update set organization_id = excluded.organization_id,
        slug = excluded.slug, name = excluded.name, legacy_dealer_id = excluded.legacy_dealer_id,
        timezone = excluded.timezone, currency = excluded.currency, status = excluded.status
    `);
    await tx.execute(sql`
      insert into dealer_domains (id, dealer_id, hostname, verified, is_primary)
      values (${LUXXY_TENANT.domainId}::uuid, ${LUXXY_TENANT.dealerId}::uuid,
        ${LUXXY_TENANT.productionHostname}, true, true)
      on conflict (id) do update set dealer_id = excluded.dealer_id,
        hostname = excluded.hostname, verified = true, is_primary = true
    `);
    await tx.execute(sql`
      insert into integration_providers (id, key, name)
      values (${LUXXY_TENANT.autoTraderProviderId}::uuid, ${LUXXY_TENANT.autoTraderProviderKey}, 'Auto Trader')
      on conflict (id) do update set key = excluded.key, name = excluded.name
    `);
    await tx.execute(sql`
      insert into dealer_integrations (id, dealer_id, provider_id, external_account_id, status, is_primary)
      values (${LUXXY_TENANT.autoTraderIntegrationId}::uuid, ${LUXXY_TENANT.dealerId}::uuid,
        ${LUXXY_TENANT.autoTraderProviderId}::uuid, ${LUXXY_TENANT.autoTraderRetailerId}, 'active', true)
      on conflict (id) do update set dealer_id = excluded.dealer_id,
        provider_id = excluded.provider_id, external_account_id = excluded.external_account_id,
        status = excluded.status, is_primary = excluded.is_primary
    `);
    await tx.execute(sql`
      update stock_import_runs set
        tenant_dealer_id = ${LUXXY_TENANT.dealerId}::uuid,
        dealer_integration_id = ${LUXXY_TENANT.autoTraderIntegrationId}::uuid
      where dealer_id = ${LUXXY_TENANT.legacyDealerId} and source = 'autotrader'
        and (tenant_dealer_id is distinct from ${LUXXY_TENANT.dealerId}::uuid
          or dealer_integration_id is distinct from ${LUXXY_TENANT.autoTraderIntegrationId}::uuid)
    `);
    await tx.execute(sql`
      update vehicles set
        tenant_dealer_id = ${LUXXY_TENANT.dealerId}::uuid,
        dealer_integration_id = ${LUXXY_TENANT.autoTraderIntegrationId}::uuid
      where dealer_id = ${LUXXY_TENANT.legacyDealerId} and source = 'autotrader'
        and (tenant_dealer_id is distinct from ${LUXXY_TENANT.dealerId}::uuid
          or dealer_integration_id is distinct from ${LUXXY_TENANT.autoTraderIntegrationId}::uuid)
    `);
    await tx.execute(sql`
      update vehicle_images i set tenant_dealer_id = v.tenant_dealer_id,
        dealer_integration_id = v.dealer_integration_id
      from vehicles v where i.vehicle_id = v.id
        and v.tenant_dealer_id = ${LUXXY_TENANT.dealerId}::uuid
        and (i.tenant_dealer_id is distinct from v.tenant_dealer_id
          or i.dealer_integration_id is distinct from v.dealer_integration_id)
    `);
    await tx.execute(sql`
      update vehicle_changes c set tenant_dealer_id = v.tenant_dealer_id,
        dealer_integration_id = v.dealer_integration_id
      from vehicles v where c.vehicle_id = v.id
        and v.tenant_dealer_id = ${LUXXY_TENANT.dealerId}::uuid
        and (c.tenant_dealer_id is distinct from v.tenant_dealer_id
          or c.dealer_integration_id is distinct from v.dealer_integration_id)
    `);
  });
}