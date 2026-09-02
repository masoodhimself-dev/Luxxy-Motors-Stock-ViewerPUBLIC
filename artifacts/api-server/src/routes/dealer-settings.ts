import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, dealerSettingsTable } from "@workspace/db";
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
  warranty: { enabled: true, title: "Warranty", description: "Warranty options are available on eligible vehicles.", ctaLabel: "Learn About Warranty" },
  delivery: { enabled: true, title: "Nationwide Delivery", description: "Customers may be able to have their vehicle delivered.", ctaLabel: "Ask About Delivery" },
  partExchange: { enabled: true, title: "Looking to part exchange your current car?", description: "Give us your registration and mileage and we’ll help you understand what your current car could be worth.", ctaLabel: "Value My Car" },
  bookViewing: { title: "Seen something you like?", description: "Arrange a viewing at a time that suits you.", ctaLabel: "Book a Viewing" },
  trustItems: ["Warranty available", "Nationwide delivery", "Carefully selected vehicles", "Straightforward buying"],
  whyBuy: [
    { title: "Quality Vehicles", description: "Carefully selected used vehicles." },
    { title: "Transparent Buying", description: "Clear vehicle information and straightforward pricing." },
    { title: "Warranty Options", description: "Warranty options available on eligible vehicles." },
    { title: "Customer Support", description: "Support throughout the purchase and handover process." },
  ],
};

async function getOrCreateSettings() {
  const id = dealerId();
  const [existing] = await db.select().from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, id));
  if (existing) return existing.config;
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

router.patch("/dealer-settings", async (req, res): Promise<void> => {
  const parsed = UpdateDealerSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [settings] = await db
    .insert(dealerSettingsTable)
    .values({ dealerId: dealerId(), config: parsed.data })
    .onConflictDoUpdate({
      target: dealerSettingsTable.dealerId,
      set: { config: parsed.data, updatedAt: new Date() },
    })
    .returning();
  res.json(UpdateDealerSettingsResponse.parse(settings.config));
});

export default router;