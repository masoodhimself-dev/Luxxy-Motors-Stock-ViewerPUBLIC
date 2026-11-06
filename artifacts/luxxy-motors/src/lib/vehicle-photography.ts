import type { CarImage } from "./stock-context";
import { getSafeImageUrl } from "./utils";

export type PhotoGroup =
  "Exterior" | "Interior" | "Details" | "Condition" | "Other";
export type PhotoShortcut = {
  label: "Boot space" | "Rear seats" | "Parking camera";
  index: number;
};

// These rules use supplied captions only. Unlabelled photos remain unclassified.
function photoCaption(image: CarImage): string {
  return (typeof image === "string" ? "" : image.caption || "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const conditionCaption =
  /\b(?:condition|damage[ds]?|scratch(?:es|ed)?|scuff(?:s|ed)?|dent(?:s|ed)?|chip(?:s|ped)?|corrosion|rust|wear|tear|imperfections?|stain(?:s|ed)?|crack(?:s|ed)?|defects?|faults?)\b/;
const parkingCameraCaption =
  /\b(?:(?:rear(?: view)?|reversing|reverse|parking|surround(?: view)?|360(?:°| degree)?) cameras?|camera (?:rear|view|display))\b/;
const rearSeatsCaption =
  /\b(?:rear seats?|back seats?|seats? (?:rear|back)|(?:second|third|2nd|3rd) row(?: seats?)?)\b/;
const frontSeatsCaption =
  /\b(?:front seats?|(?:driver|passenger)(?:['’]s)? seats?|seats? (?:front|driver|passenger))\b/;
const dashboardCaption =
  /\b(?:dashboard|dash(?: board)?|cockpit|driver instruments|instrument (?:cluster|panel))\b/;

function isBootSpace(caption: string): boolean {
  return (
    /\b(?:boot|luggage (?:space|area|compartment)|cargo (?:space|area)|load (?:space|area))\b/.test(
      caption,
    ) && !/\b(?:boot (?:lid|badge|lock|handle)|tailgate)\b/.test(caption)
  );
}

export function photoGroup(image: CarImage): PhotoGroup {
  const caption = photoCaption(image);
  if (conditionCaption.test(caption)) return "Condition";
  if (parkingCameraCaption.test(caption)) return "Details";
  // Interior terms must win over words such as "wheel", "front" and "rear".
  if (
    /\b(?:interior|seats?|cabin|steering(?: wheel)?|console|screen|controls?|door cards?)\b/.test(
      caption,
    ) ||
    dashboardCaption.test(caption) ||
    rearSeatsCaption.test(caption) ||
    frontSeatsCaption.test(caption) ||
    isBootSpace(caption)
  )
    return "Interior";
  if (
    /\b(?:wheels?|tyres?|tires?|alloys?|service|documents?|engine|badges?|keys?|camera|sensors?|headlights?|sunroof|features?|equipment|infotainment)\b/.test(
      caption,
    )
  )
    return "Details";
  if (
    /\b(?:front|rear|side|exterior|outside|tailgate|wing mirror)\b/.test(
      caption,
    )
  )
    return "Exterior";
  return "Other";
}

export function orderVehiclePhotos(
  images: CarImage[],
  heroImage?: string | null,
): CarImage[] {
  const byUrl = new Map<string, CarImage>();
  for (const image of images) {
    const url = getSafeImageUrl(image);
    if (!url) continue;
    const existing = byUrl.get(url);
    // Keep the original position, while retaining a caption when a duplicate adds one.
    if (!existing || (!photoCaption(existing) && photoCaption(image)))
      byUrl.set(url, image);
  }
  const unique = [...byUrl.values()];
  if (!unique.length && !heroImage) return [];

  const hero = (heroImage && byUrl.get(heroImage)) || heroImage || unique[0];
  const ordered: CarImage[] = [hero];
  const used = new Set([getSafeImageUrl(hero)]);
  const earlyViews = [
    (caption: string) => dashboardCaption.test(caption),
    (caption: string) => frontSeatsCaption.test(caption),
    (caption: string) => rearSeatsCaption.test(caption),
    isBootSpace,
  ];
  for (const matches of earlyViews) {
    const image = unique.find(
      (candidate) =>
        !used.has(getSafeImageUrl(candidate)) &&
        photoGroup(candidate) === "Interior" &&
        matches(photoCaption(candidate)),
    );
    if (image) {
      ordered.push(image);
      used.add(getSafeImageUrl(image));
    }
  }
  // Leave the remaining supplied sequence intact, particularly unlabelled photos.
  return [
    ...ordered,
    ...unique.filter((image) => !used.has(getSafeImageUrl(image))),
  ];
}

export function getPhotoShortcuts(images: CarImage[]): PhotoShortcut[] {
  const shortcuts: Array<{
    label: PhotoShortcut["label"];
    matches: (caption: string) => boolean;
  }> = [
    { label: "Boot space", matches: isBootSpace },
    {
      label: "Rear seats",
      matches: (caption) => rearSeatsCaption.test(caption),
    },
    {
      label: "Parking camera",
      matches: (caption) => parkingCameraCaption.test(caption),
    },
  ];
  return shortcuts.flatMap(({ label, matches }) => {
    const index = images.findIndex((image) => {
      const caption = photoCaption(image);
      return (
        Boolean(getSafeImageUrl(image)) &&
        !conditionCaption.test(caption) &&
        !/\b(?:no|without|missing|unavailable|not fitted|not working)\b/.test(
          caption,
        ) &&
        matches(caption)
      );
    });
    return index < 0 ? [] : [{ label, index }];
  });
}
