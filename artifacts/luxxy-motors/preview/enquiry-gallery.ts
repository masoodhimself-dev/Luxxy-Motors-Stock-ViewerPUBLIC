/** Existing stock-photo URLs only. No uploads, video or private share packs. */
import { previewStock } from './stock';
export function previewEnquiryGallery(vehicleId: string | null | undefined) {
  const car = previewStock.cars.find(car => car.id === vehicleId);
  return { vehiclePhotos: (car?.images ?? []).slice(0, 100).map((image, index) => ({ index, url: typeof image === 'string' ? image : image.url })) };
}
