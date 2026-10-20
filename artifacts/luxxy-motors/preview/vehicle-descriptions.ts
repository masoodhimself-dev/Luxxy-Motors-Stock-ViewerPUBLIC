import type { IncomingMessage, ServerResponse } from "node:http";
import { previewStock } from "./stock";
import {
  descriptionView,
  descriptionVersion,
  descriptionFactsHash,
  descriptionMetadata,
  originalDescriptions,
  publishedDescription,
  type DescriptionVehicle,
} from "../../api-server/src/lib/vehicle-descriptions";
// Opt-in local walkthrough. Memory only; no AI call, credentials, real database,
// publication, email or import. The example is clearly identified as sample copy.
const cars = new Map<string, DescriptionVehicle>();
export async function vehicleDescriptionPreview(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (process.env.VEHICLE_DESCRIPTION_PREVIEW !== "true") return false;
  const match =
    /^\/api\/staff\/vehicle-descriptions\/([^/]+)(\/generate)?$/.exec(
      url.pathname,
    );
  if (!match) return false;
  const source = previewStock.cars.find((car) => car.id === match[1]);
  const send = (body: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
    return true;
  };
  if (!source) return send({ error: "Preview car not found." }, 404);
  let car = cars.get(source.id);
  if (!car) {
    car = {
      ...source,
      rawSourceData: source,
      auditMetadata: {},
      websiteDescription: null,
    };
    cars.set(source.id, car);
  }
  if (req.method === "GET")
    return send({
      ...descriptionView(car),
      aiAvailable: true,
      previewExample: true,
    });
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_000)
      return send({ error: "Description too long." }, 413);
  }
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw);
  } catch {
    return send({ error: "Invalid request." }, 400);
  }
  if (input.expectedVersion !== descriptionVersion(car))
    return send(
      { error: "Preview changed. Reload its latest description." },
      409,
    );
  if (req.method === "POST" && match[2]) {
    // Exact sample wording is grounded in the first archived Ford Focus record.
    const example =
      source.make === "Ford" && source.model === "Focus"
        ? "This red 2015 Ford Focus Zetec has a 1.0-litre petrol engine, a manual gearbox and 74,200 miles on the clock. Its five-door layout gives you access to five seats.\n\nInside, there’s air conditioning, Bluetooth audio streaming and a USB connection. Ford DAB audio with SYNC and steering-wheel audio controls are also included.\n\nA heated front windscreen and heated electric door mirrors are useful on colder mornings. The equipment list also includes ISOFIX child-seat mounting points, hill-start assist and 16-inch alloy wheels."
        : `${source.year ?? ""} ${source.make ?? ""} ${source.model ?? ""} with ${source.mileage?.toLocaleString("en-GB") ?? "unconfirmed"} miles. ${source.fuel ?? ""} engine and ${source.transmission ?? ""} gearbox. Review the original advert and equipment before publishing.`;
    car.auditMetadata = {
      vehicleDescription: {
        firstOriginals: originalDescriptions(car),
        draft: {
          requestId: String(input.requestId),
          status: "ready",
          text: example,
          factsHash: descriptionFactsHash(car),
          startedAt: new Date().toISOString(),
        },
      },
    };
    return send({
      ...descriptionView(car),
      aiAvailable: true,
      previewExample: true,
    });
  }
  if (req.method === "PUT") {
    const meta = descriptionMetadata(car);
    if (input.action === "publish") {
      if (input.reviewed !== true)
        return send({ error: "Review required." }, 400);
      car.websiteDescription = publishedDescription(
        String(input.description),
        car,
      );
      delete meta.draft;
    } else if (input.action === "restore") {
      car.websiteDescription = null;
      delete meta.draft;
    } else if (input.action === "save-draft")
      meta.draft = {
        requestId: "preview-edit",
        status: "ready",
        text: String(input.description),
        factsHash: descriptionFactsHash(car),
        startedAt: new Date().toISOString(),
      };
    else return send({ error: "Unknown action." }, 400);
    car.auditMetadata = { vehicleDescription: meta };
    return send({
      ...descriptionView(car),
      aiAvailable: true,
      previewExample: true,
    });
  }
  return send({ error: "Unavailable in this preview." }, 405);
}
