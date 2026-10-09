import { currentDealerId, multiTenantEnabled } from "../lib/tenant-context";
import { bookingPolicyError, defaultBookingPolicy } from "../lib/booking-slots";
import { preserveTestDriveBooking, preserveBrochure, preserveOnlineReservation, preservePresentation, reservationSettingsError } from "../lib/settings-content";
import { Router, type IRouter } from "express";
import { requirePermission, requireStaff, staffLabel } from "../middlewares/staff-auth";
import { eq } from "drizzle-orm";
import { db, pool, dealerSettingsTable, vehiclesTable } from "@workspace/db";
import { expectedSettingsRevision, PostgresSettingsVersionStore, SettingsVersionError, type SettingsQueryClient } from '../lib/settings-versions';
import {
  GetDealerSettingsResponse,
  UpdateDealerSettingsBody,
  UpdateDealerSettingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const dealerId = () => currentDealerId();

export const defaultSettings = {
  testDriveBooking: defaultBookingPolicy,
  identity: {
    name: "Luxxy Motors",
    logoText: "LUXXY MOTORS",
    logoAsset: "",
    brandColors: { primaryHsl: "222 47% 11%", accentHsl: "38 92% 50%" },
  },
  contact: { phone: "02084729917", whatsapp: "+447388831790", email: "" },
  address: { street: "", city: "Harrow", region: "London", postcode: "", mapsUrl: "" },
  hours: [
    { days: "Monday - Friday", times: "9:00am - 6:00pm" },
    { days: "Saturday", times: "9:00am - 5:00pm" },
    { days: "Sunday", times: "By appointment" },
  ],
  legal: { companyName: "Luxxy Motors", companyNumber: "", vatNumber: "", termsUrl: "", privacyUrl: "", cookieUrl: "" },
  social: { instagram: "", facebook: "", twitter: "" },
  hero: {
    announcement: "",
    copy: "Find Your Next Car",
    subcopy: "Quality used vehicles. Straightforward buying. Exceptional service.",
    primaryCta: "See All Cars",
    secondaryCta: "Get a Part-Exchange Valuation",
  },
  featuredVehicleIds: [],
  warranty: { enabled: true, title: "Warranty", description: "Warranty options are available on eligible vehicles.", ctaLabel: "Learn About Warranty" },
  delivery: { enabled: true, title: "Nationwide Delivery", description: "Customers may be able to have their vehicle delivered.", ctaLabel: "Ask About Delivery" },
  partExchange: { enabled: true, title: "Looking to part exchange your current car?", description: "Give us your registration and mileage and we’ll help you understand what your current car could be worth.", ctaLabel: "Value My Car" },
  onlineReservation: { enabled: false, depositPence: 10000, terms: "" },
  bookViewing: { title: "Seen something you like?", description: "Arrange a viewing at a time that suits you.", ctaLabel: "Book a Viewing" },
  // Disabled until the dealer opts into publishing anonymised completed-sales proof.
  recentHandovers: { enabled: false, count: 3 },
  trustItems: ["Warranty available", "Nationwide delivery", "Carefully selected vehicles", "Straightforward buying"],
  whyBuy: [
    { title: "Quality Vehicles", description: "Carefully selected used vehicles." },
    { title: "Transparent Buying", description: "Clear vehicle information and straightforward pricing." },
    { title: "Warranty Options", description: "Warranty options available on eligible vehicles." },
    { title: "Customer Support", description: "Support throughout the purchase and handover process." },
  ],
};

type Settings = typeof UpdateDealerSettingsBody._output;

type FeaturedVehicle = Pick<typeof vehiclesTable.$inferSelect, 'id' | 'inventoryStatus' | 'missingCount' | 'priceReviewRequired' | 'sourcePrice' | 'websitePriceOverride'>;
function stockIsVisible(vehicle: FeaturedVehicle): boolean {
  const missingHideThreshold = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD);
  const threshold = Number.isFinite(missingHideThreshold) && missingHideThreshold >= 0 ? missingHideThreshold : 2;
  return (
    ["available", "reserved"].includes(vehicle.inventoryStatus) &&
    vehicle.missingCount < threshold &&
    !(vehicle.priceReviewRequired && vehicle.sourcePrice == null && vehicle.websitePriceOverride == null)
  );
}

async function cleanFeaturedVehicles(settings: Settings, client?: SettingsQueryClient): Promise<Settings> {
  if (settings.featuredVehicleIds.length === 0) return settings;
  // A publisher already owns a transaction connection and a settings lock.
  // Reuse it rather than waiting for a second pool connection under that lock.
  const vehicles = client
    ? (await client.query('SELECT id, inventory_status AS "inventoryStatus", missing_count AS "missingCount", price_review_required AS "priceReviewRequired", source_price AS "sourcePrice", website_price_override AS "websitePriceOverride" FROM vehicles WHERE dealer_id=$1', [dealerId()])).rows as FeaturedVehicle[]
    : await db.select().from(vehiclesTable).where(eq(vehiclesTable.dealerId, dealerId()));
  const visibleIds = new Set(vehicles.filter(stockIsVisible).map((vehicle) => vehicle.id));
  const featuredVehicleIds = settings.featuredVehicleIds.filter((id) => visibleIds.has(id));
  return featuredVehicleIds.length === settings.featuredVehicleIds.length
    ? settings
    : { ...settings, featuredVehicleIds };
}

async function settingsSnapshot(): Promise<{ config: Settings; revision: number }> {
  const id = dealerId();
  const [existing] = await db.select().from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, id));
  if (existing) {
    const parsed = UpdateDealerSettingsBody.parse({
      ...defaultSettings,
      ...(existing.config as object),
      featuredVehicleIds: Array.isArray((existing.config as Record<string, unknown>).featuredVehicleIds)
        ? (existing.config as Record<string, unknown>).featuredVehicleIds
        : [],
    });
    const cleaned = await cleanFeaturedVehicles(parsed);
    return { config: cleaned, revision: existing.revision };
  }
  if (multiTenantEnabled()) throw new Error("Dealership settings must be provisioned before activation.");
  await db.insert(dealerSettingsTable).values({ dealerId: id, config: defaultSettings }).onConflictDoNothing();
  return settingsSnapshot();
}
export async function getOrCreateSettings() { return (await settingsSnapshot()).config; }

function readText(source: unknown, key: string): string {
  if (!source || typeof source !== "object") return "";
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The dealer's name and town for page titles and link previews, taken from the
 * settings the dealer edits rather than from imported advert data.
 */
export async function getDealerIdentity(): Promise<{ name: string; location: string }> {
  const config = await getOrCreateSettings();
  const identity = (config as Record<string, unknown>).identity;
  const address = (config as Record<string, unknown>).address;
  return {
    name: readText(identity, "name") || defaultSettings.identity.name,
    location: readText(address, "city") || readText(address, "region"),
  };
}

async function validatePublication(incoming: Record<string, unknown>, previous: Record<string, unknown>, client: SettingsQueryClient) {
  const parsed = UpdateDealerSettingsBody.safeParse(incoming);
  if (!parsed.success) {
    throw new SettingsVersionError(parsed.error.message, 400);
  }
  const compatible = UpdateDealerSettingsBody.parse(preserveTestDriveBooking(preserveBrochure(preserveOnlineReservation(preservePresentation(parsed.data, previous), previous), previous), previous));
  const reservationError = reservationSettingsError(compatible.onlineReservation) ?? bookingPolicyError(compatible.testDriveBooking);
  if (reservationError) throw new SettingsVersionError(reservationError, 400);
  return await cleanFeaturedVehicles(compatible, client) as Record<string, unknown>;
}
function settingsFailure(req: import('express').Request, res: import('express').Response, error: unknown) {
  if (error instanceof SettingsVersionError) {
    if (error.revision !== undefined) res.setHeader('x-settings-revision', String(error.revision));
    res.status(error.status).json({ error: error.message, ...(error.revision === undefined ? {} : { revision: error.revision }) }); return;
  }
  req.log.error({ err: error }, 'Settings request failed');
  const schemaMissing = ['42P01', '42703'].includes((error as { code?: string }).code ?? '');
  res.status(schemaMissing ? 503 : 500).json({ error: schemaMissing ? 'Settings history requires migration 0017 on this deployment.' : 'Settings could not be loaded or published.' });
}
router.get("/dealer-settings", async (req, res): Promise<void> => {
  try {
    const { config, revision } = await settingsSnapshot();
    res.setHeader('x-settings-revision', String(revision));
    res.setHeader('ETag', `"${revision}"`);
    res.json(GetDealerSettingsResponse.parse(config));
  } catch (error) { settingsFailure(req, res, error); }
});
router.patch("/dealer-settings", requireStaff, requirePermission('settings.publish'), async (req, res): Promise<void> => {
  try {
    const result = await new PostgresSettingsVersionStore(dealerId(), pool).publish({ config: req.body, expectedRevision: expectedSettingsRevision(req.headers['if-match']), actor: staffLabel(req), validate: validatePublication });
    res.setHeader('x-settings-revision', String(result.revision)); res.setHeader('ETag', `"${result.revision}"`);
    res.json(UpdateDealerSettingsResponse.parse(result.config));
  } catch (error) { settingsFailure(req, res, error); }
});
router.get('/staff/settings-history', requireStaff, requirePermission('settings.publish'), async (req, res) => {
  try {
    await getOrCreateSettings();
    await pool.query("INSERT INTO dealer_settings_versions(dealer_id,revision,config,published_at,published_by,action) SELECT dealer_id,revision,config,updated_at,'Initial settings','initial' FROM dealer_settings WHERE dealer_id=$1 ON CONFLICT DO NOTHING", [dealerId()]);
    const versions = await new PostgresSettingsVersionStore(dealerId(), pool).history();
    res.setHeader('Cache-Control', 'no-store'); res.json({ revision: versions[0]?.revision ?? 0, versions });
  } catch (error) { settingsFailure(req, res, error); }
});
router.post('/staff/settings-history/:version/restore', requireStaff, requirePermission('settings.publish'), async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.version)) throw new SettingsVersionError('Settings version not found.', 404);
    const result = await new PostgresSettingsVersionStore(dealerId(), pool).publish({ expectedRevision: expectedSettingsRevision(req.headers['if-match']), actor: staffLabel(req), restoredFrom: Number(req.params.version), validate: validatePublication });
    res.setHeader('x-settings-revision', String(result.revision)); res.json({ revision: result.revision, config: UpdateDealerSettingsResponse.parse(result.config) });
  } catch (error) { settingsFailure(req, res, error); }
});

export default router;
