import type { CarImage } from "./stock-context";
import { getSafeImageUrl } from "./utils";
export type PhotoGroup = "Exterior" | "Interior" | "Details" | "Other";
export function photoGroup(image: CarImage): PhotoGroup {
  const caption = typeof image === "string" ? "" : image.caption || "";
  if (
    /wheel|tyre|alloy|damage|scratch|service|document|engine|badge|key/i.test(
      caption,
    )
  )
    return "Details";
  if (/interior|seat|cabin|dash|boot|steering|console|screen/i.test(caption))
    return "Interior";
  if (/front|rear|side|exterior/i.test(caption)) return "Exterior";
  return "Other";
}
export function orderVehiclePhotos(
  images: CarImage[],
  heroImage?: string | null,
): CarImage[] {
  const unique = [
    ...new Map(
      images
        .filter((image) => getSafeImageUrl(image))
        .map((image) => [getSafeImageUrl(image), image]),
    ).values(),
  ];
  if (
    heroImage &&
    !unique.some((image) => getSafeImageUrl(image) === heroImage)
  )
    unique.unshift(heroImage);
  const rank = (image: CarImage) =>
    getSafeImageUrl(image) === heroImage
      ? -1
      : ["Exterior", "Interior", "Details", "Other"].indexOf(photoGroup(image));
  return unique.sort((a, b) => rank(a) - rank(b));
}
