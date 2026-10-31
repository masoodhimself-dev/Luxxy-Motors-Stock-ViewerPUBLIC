import { Router } from "express";
import { randomBytes, createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { currentDealerId } from "./tenant-context";
import { enforceStaffWriteOrigin } from "../middlewares/staff-write-origin";
import { AiError, aiConfigured, aiHash, generateAi } from "./ai-assistance";
import { AiAssistanceStore } from "./ai-assistance-store";
import {
  publicAiCar,
  publicAiDealer,
  verifiedAiMatches,
  redactAiText,
} from "./ai-public-facts";
const schema = z
  .object({
    kind: z.enum(["question", "finder", "faqs", "explain", "reply"]),
    requestId: z.string().uuid(),
    text: z.string().trim().max(800).optional(),
    vehicleId: z.string().uuid().optional(),
    enquiryId: z.string().uuid().optional(),
  })
  .strict();
const cookie = "luxxy_ai_session";
type Dependencies = {
  store: AiAssistanceStore;
  getSettings: (dealer: string) => Promise<any>;
  getCars: () => Promise<any[]>;
  getCar: (id: string) => Promise<any | null>;
  getEnquiry: (dealer: string, id: string) => Promise<any | null>;
  staffAccess: import("express").RequestHandler[];
  motFact?: (car: any) => Promise<any>;
  generate?: typeof generateAi;
  configured?: () => boolean;
};
export function aiAssistanceRouter(deps: Dependencies) {
  const router = Router(),
    store = deps.store,
    rates = new Map<string, { at: number; count: number }>();
  const enabled = deps.configured ?? aiConfigured;
  function session(req: any, res: any) {
    let token = req.cookies?.[cookie];
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      token = randomBytes(32).toString("hex");
      res.cookie(cookie, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.secure,
        path: "/api/ai",
      });
    }
    return createHash("sha256").update(token).digest("hex");
  }
  router.use(["/ai", "/staff/ai"], (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method === "POST" && !enforceStaffWriteOrigin(req, res)) return;
    next();
  });
  router.get("/ai/status", async (req, res) => {
    try {
      if (!enabled()) {
        res.json({ enabled: false, remaining: 10, limit: 10 });
        return;
      }
      const hash = session(req, res);
      res.json({
        enabled: true,
        remaining: await store.remaining(currentDealerId(), hash),
        limit: 10,
      });
    } catch {
      res
        .status(503)
        .json({
          enabled: false,
          error: "AI is unavailable. Normal search and enquiries still work.",
        });
    }
  });
  const run = async (req: any, res: any, staff = false) => {
    let reservation: { id: string; cached: any; remaining: number } | undefined;
    const dealer = currentDealerId();
    try {
      if (!enabled())
        throw new AiError(
          "not_configured",
          "AI is not connected yet. You can still use saved answers and normal search.",
        );
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        throw new AiError(
          "invalid_request",
          "Enter a short question or search.",
          400,
        );
      const body = parsed.data;
      if (staff !== (body.kind === "reply") || (!staff && body.enquiryId))
        throw new AiError(
          "invalid_request",
          "This action is unavailable.",
          400,
        );
      if (["question", "finder", "explain"].includes(body.kind) && !body.text)
        throw new AiError(
          "invalid_request",
          "Enter your question or search.",
          400,
        );
      const rateKey = `${dealer}:${req.ip}`,
        now = Date.now();
      let rate = rates.get(rateKey);
      if (!rate || rate.at < now - 60000) {
        if (rates.size > 5000) rates.delete(rates.keys().next().value!);
        rate = { at: now, count: 0 };
        rates.set(rateKey, rate);
      }
      if (++rate.count > 20)
        throw new AiError(
          "too_many",
          "Please wait a minute before trying again.",
          429,
        );
      const config = await deps.getSettings(dealer);
      if (!config)
        throw new AiError(
          "settings_unavailable",
          "Dealer information is unavailable. Please try later.",
        );
      let cars: any[] = [],
        question = redactAiText(body.text ?? ""),
        enquiry: any = null;
      if (staff) {
        if (!body.enquiryId)
          throw new AiError("enquiry_required", "Choose an enquiry.", 400);
        enquiry = await deps.getEnquiry(dealer, body.enquiryId);
        if (!enquiry) throw new AiError("not_found", "Enquiry not found.", 404);
        question = redactAiText(enquiry.message, [enquiry.customerName]);
        if (enquiry.vehicleId) {
          const car = await deps.getCar(enquiry.vehicleId);
          if (car) cars = [publicAiCar(car)];
        }
      } else if (body.kind === "finder") {
        cars = (await deps.getCars())
          .filter((c) => c.inventoryStatus === "available")
          .map((c) => publicAiCar(c, true));
        cars = cars.slice(0, 45);
      } else if (body.vehicleId) {
        const car = await deps.getCar(body.vehicleId);
        if (!car)
          throw new AiError(
            "not_found",
            "This car is no longer available.",
            404,
          );
        cars = [publicAiCar(car)];
      } else throw new AiError("vehicle_required", "Choose a car first.", 400);
      if (body.kind === "explain" && !cars[0]?.features?.includes(body.text))
        throw new AiError(
          "feature_not_listed",
          "Choose one of this car’s listed features.",
          400,
        );
      if (deps.motFact && cars.length === 1 && body.kind !== "finder")
        cars[0].mot = await deps.motFact(cars[0]);
      const facts = {
        dealer: publicAiDealer(config),
        cars,
        ...(staff
          ? { enquiry: { type: enquiry.type, message: question } }
          : {}),
      };
      const hash = aiHash({ version: 1, task: body.kind, question, facts });
      const sessionHash = staff
        ? aiHash({
            dealer,
            staff: req.staff.authUserId,
            day: new Date().toISOString().slice(0, 10),
          })
        : session(req, res);
      const ip = createHmac("sha256", process.env.OPENAI_API_KEY!)
        .update(String(req.ip ?? "unknown"))
        .digest("hex");
      const cacheKey = staff || body.kind === "question" ? null : hash;
      reservation = await store.reserve({
        dealer,
        session: sessionHash,
        ip,
        requestId: body.requestId,
        hash,
        cacheKey,
        staff,
      });
      if (reservation.cached) {
        res.json({
          ...reservation.cached,
          remaining: reservation.remaining,
          cached: true,
        });
        return;
      }
      const generated = await (deps.generate ?? generateAi)(
        body.kind,
        question,
        facts,
      );
      if (body.kind === "finder") {
        generated.result.vehicleIds = verifiedAiMatches(
          generated.result.vehicleIds,
          cars,
          question,
        );
        generated.result.answer = generated.result.vehicleIds.length
          ? "These available cars match your request. Check each advert for the full details."
          : "No verified matches were found in this selection. Try changing your requirements or use the full stock filters.";
      }
      // Never persist personal staff reply text in a public answer cache.
      await store.complete(
        reservation.id,
        dealer,
        generated.result,
        generated.cost,
        cacheKey,
      );
      res.json({
        ...generated.result,
        remaining: reservation.remaining,
        cached: false,
      });
    } catch (error) {
      if (reservation && !reservation.cached)
        await store.fail(reservation.id, dealer).catch(() => {});
      if (error instanceof AiError) {
        res
          .status(error.status)
          .json({ error: error.message, code: error.code });
        return;
      }
      res
        .status(503)
        .json({
          error:
            "AI is temporarily unavailable. Saved answers, normal search and manual replies still work.",
          code: "ai_unavailable",
        });
    }
  };
  router.get("/staff/ai/status", ...deps.staffAccess, async (req, res) => {
    try {
      if (!enabled()) {
        res.json({ enabled: false, remaining: 10, limit: 10 });
        return;
      }
      const hash = aiHash({
        dealer: currentDealerId(),
        staff: req.staff!.authUserId,
        day: new Date().toISOString().slice(0, 10),
      });
      res.json({
        enabled: true,
        remaining: await store.remaining(currentDealerId(), hash),
        limit: 10,
      });
    } catch {
      res.status(503).json({ enabled: false });
    }
  });
  router.post("/ai/assist", (req, res) => void run(req, res));
  router.post(
    "/staff/ai/reply",
    ...deps.staffAccess,
    (req, res) => void run(req, res, true),
  );
  return router;
}
