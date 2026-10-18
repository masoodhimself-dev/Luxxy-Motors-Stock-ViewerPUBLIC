import type { IncomingMessage, ServerResponse } from "node:http";
import { previewStock } from "./stock";

// Explicit opt-in browser fixture: public stock photos, fictional records, memory-only writes.
// Never imported by the production entry point. No email, database or importer is used.
const cars = previewStock.cars.slice(0, 3).map((car, index) => ({
  id: car.id,
  title: `Fictional check ${index + 1} · ${car.make} ${car.model}`,
  make: car.make,
  model: car.model,
  plate: null as string | null,
  vrm: null as string | null,
  registration: car.registrationBand,
  year: car.year,
  mileage: car.mileage,
  fuel: car.fuel,
  transmission: car.transmission,
  price: car.price,
  photo: car.heroImage,
  inventory_status: "available",
  source_status: "live",
  missing_count: 0,
  service_photo_count: 0,
  tasks: null,
}));
export async function plateEntryQa(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  if (
    process.env.PLATE_ENTRY_QA_FIXTURE !== "true" ||
    !url.pathname.startsWith("/api/staff/inventory")
  )
    return false;
  const send = (data: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(data));
    return true;
  };
  if (url.pathname === "/api/staff/inventory" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    return send({
      cars: cars.filter((car) =>
        `${car.title} ${car.plate || ""}`.toLowerCase().includes(q),
      ),
      counts: { current: cars.length, archived: 0 },
      nextCursor: null,
    });
  }
  const match = /^\/api\/staff\/inventory\/([^/]+)(\/plate|\/customers)?$/.exec(
    url.pathname,
  );
  const car = cars.find((car) => car.id === match?.[1]);
  if (!car) return send({ error: "Fictional car not found." }, 404);
  if (req.method === "GET" && match?.[2] === "/customers")
    return send({ customers: [] });
  if (req.method === "GET" && !match?.[2])
    return send({
      car,
      vehiclePhotos:
        previewStock.cars.find((row) => row.id === car.id)?.images || [],
      preparation: {
        revision: 0,
        tasks: {
          cleaning: "pending",
          inspection: "pending",
          mot: "pending",
          servicing: "pending",
        },
        assigned_to_id: null,
        due_date: null,
        notes: "Fictional browser test",
      },
      photos: [],
    });
  if (req.method === "PUT" && match?.[2] === "/plate") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 2048) return send({ error: "Too large" }, 413);
    }
    let input: { plate?: string; expectedPlate?: string | null };
    try {
      input = JSON.parse(raw);
    } catch {
      return send({ error: "Invalid JSON" }, 400);
    }
    const plate =
      typeof input.plate === "string"
        ? input.plate.replace(/\s/g, "").toUpperCase()
        : "";
    if (!/^[A-Z0-9]{2,8}$/.test(plate))
      return send({ error: "Check the plate." }, 400);
    if (input.expectedPlate !== car.plate)
      return send({ error: "The plate changed elsewhere." }, 409);
    car.plate = plate;
    car.vrm = plate;
    return send({ saved: true });
  }
  return send({ error: "Unavailable in the memory-only plate fixture." }, 405);
}
