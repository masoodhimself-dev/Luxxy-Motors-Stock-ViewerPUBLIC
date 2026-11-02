import { createHash } from "node:crypto";
import {
  brochureFilename, brochureOptions, brochurePhotos,
  renderVehicleBrochure, selectBrochurePhotos,
  type BrochureDealer, type BrochureVehicle, type BrochurePhoto, type LoadedPhoto,
} from "./vehicle-brochure";
import { loadBrochurePhotos } from "./vehicle-brochure-images";

export class EnquiryVehiclePdfError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export const enquiryVehiclePdfMaximumBytes = 8_000_000;
export type VehiclePdfAttachment = { id: string; filename: string; content: string };

/** Uses public stock and the existing renderer, never a self-request or AI call. */
export function createEnquiryVehiclePdf(dependencies: {
  findVehicle: (id: string) => Promise<BrochureVehicle | null>;
  readDealer: () => Promise<BrochureDealer>;
  loadPhotos?: (photos: BrochurePhoto[]) => Promise<LoadedPhoto[]>;
  render?: typeof renderVehicleBrochure;
  preview?: boolean;
}) {
  return async (vehicleId: string, origin: string): Promise<VehiclePdfAttachment> => {
    const vehicle = await dependencies.findVehicle(vehicleId);
    if (!vehicle || vehicle.id !== vehicleId) throw new EnquiryVehiclePdfError("The vehicle PDF is unavailable. Choose a current stock car or remove the PDF before reviewing this email.");
    const configured = await dependencies.readDealer();
    // Keep emailed brochures compact. The full gallery remains on the car page.
    const options = brochureOptions(configured.brochure, configured.primaryHsl);
    const dealer = { ...configured, brochure: { ...options, photoLimit: Math.min(options.photoLimit, 4) } };
    const photos = brochurePhotos(vehicle);
    let bytes: Buffer;
    try {
      const loaded = await (dependencies.loadPhotos ?? (items => loadBrochurePhotos(items, process.env.VEHICLE_PDF_IMAGE_HOSTS, 8_000)))(selectBrochurePhotos(photos, options.includeGallery ? dealer.brochure.photoLimit : 1));
      const input = { vehicle, dealer, vehicleUrl: `${origin}/vehicle/${encodeURIComponent(vehicleId)}`, photos: loaded, totalPhotos: photos.length, preview: dependencies.preview };
      const identity = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
      bytes = (dependencies.render ?? renderVehicleBrochure)({ ...input, reproducibleIdentity: identity });
    } catch {
      throw new EnquiryVehiclePdfError("The vehicle PDF could not be prepared. Try again or remove the PDF before reviewing this email.", 503);
    }
    if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new EnquiryVehiclePdfError("The vehicle PDF could not be prepared. Nothing has been sent.", 503);
    if (bytes.length > enquiryVehiclePdfMaximumBytes) throw new EnquiryVehiclePdfError("The vehicle PDF is too large to email. Remove it and share the vehicle page instead.");
    return { id: `vehicle-pdf:${vehicleId}`, filename: brochureFilename(vehicle), content: bytes.toString("base64") };
  };
}

