import { preserveBrochure, preserveOnlineReservation, preservePresentation, reservationSettingsError } from "../lib/settings-content";
import { Router, type IRouter } from "express";
import { requireStaff } from "../middlewares/staff-auth";
import { eq } from "drizzle-orm";
import { db, dealerSettingsTable, vehiclesTable } from "@workspace/db";
import {
  GetDealerSettingsResponse,
  UpdateDealerSettingsBody,
  UpdateDealerSettingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const dealerId = () => process.env.STOCK_DEALER_ID ?? "luxxy-motors";

const defaultSettings = {
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

function stockIsVisible(vehicle: typeof vehiclesTable.$inferSelect): boolean {
  const missingHideThreshold = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD);
  const threshold = Number.isFinite(missingHideThreshold) && missingHideThreshold >= 0 ? missingHideThreshold : 2;
  return (
    ["available", "reserved"].includes(vehicle.inventoryStatus) &&
    vehicle.missingCount < threshold &&
    !(vehicle.priceReviewRequired && vehicle.sourcePrice == null && vehicle.websitePriceOverride == null)
  );
}

async function cleanFeaturedVehicles(settings: Settings): Promise<Settings> {
  if (settings.featuredVehicleIds.length === 0) return settings;
  const vehicles = await db.select().from(vehiclesTable).where(eq(vehiclesTable.dealerId, dealerId()));
  const visibleIds = new Set(vehicles.filter(stockIsVisible).map((vehicle) => vehicle.id));
  const featuredVehicleIds = settings.featuredVehicleIds.filter((id) => visibleIds.has(id));
  return featuredVehicleIds.length === settings.featuredVehicleIds.length
    ? settings
    : { ...settings, featuredVehicleIds };
}

export async function getOrCreateSettings() {
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
    if (cleaned.featuredVehicleIds.length !== parsed.featuredVehicleIds.length) {
      await db.update(dealerSettingsTable).set({ config: cleaned, updatedAt: new Date() }).where(eq(dealerSettingsTable.dealerId, id));
    }
    return cleaned;
  }
  await db.insert(dealerSettingsTable).values({ dealerId: id, config: defaultSettings }).onConflictDoNothing();
  return defaultSettings;
}

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

router.get("/dealer-settings", async (_req, res): Promise<void> => {
  const config = await getOrCreateSettings();
  res.json(GetDealerSettingsResponse.parse(config));
});

router.patch("/dealer-settings", requireStaff, async (req, res): Promise<void> => {
  const parsed = UpdateDealerSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [previous] = await db.select().from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, dealerId()));
  const compatible = UpdateDealerSettingsBody.parse(preserveBrochure(preserveOnlineReservation(preservePresentation(parsed.data, previous?.config), previous?.config), previous?.config));
  const reservationError = reservationSettingsError(compatible.onlineReservation);
  if (reservationError) {
    res.status(400).json({ error: reservationError });
    return;
  }
  const cleaned = await cleanFeaturedVehicles(compatible);
  const [settings] = await db
    .insert(dealerSettingsTable)
    .values({ dealerId: dealerId(), config: cleaned })
    .onConflictDoUpdate({
      target: dealerSettingsTable.dealerId,
      set: { config: cleaned, updatedAt: new Date() },
    })
    .returning();
  res.json(UpdateDealerSettingsResponse.parse(settings.config));
});

export default router;
