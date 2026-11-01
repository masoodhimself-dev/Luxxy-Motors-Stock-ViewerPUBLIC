import { Car } from "lucide-react";
import { bodyTypeKey } from "@/lib/body-types";

const silhouettes: Record<string, string> = {
  hatchback: "hatchback",
  hatch: "hatchback",
  suv: "suv",
  sportutilityvehicle: "suv",
  sportsutilityvehicle: "suv",
  estate: "estate",
  stationwagon: "estate",
  wagon: "estate",
  saloon: "saloon",
  sedan: "saloon",
  coupe: "coupe",
  convertible: "convertible",
  convertable: "convertible",
  cabriolet: "convertible",
  cabrio: "convertible",
  mpv: "mpv",
  peoplecarrier: "mpv",
  peoplemover: "mpv",
  multipurposevehicle: "mpv",
  "4x4": "4x4",
  "4wd": "4x4",
};

/** The labelled body-type link supplies the accessible name. These supplied
 * silhouettes are decorative; unsupported types keep a neutral car outline. */
export function MultiBodyShape({ type }: { type: string }) {
  const key = bodyTypeKey(type)
    .replace(/×/g, "x")
    .replace(/[\s_-]/g, "");
  const silhouette = Object.hasOwn(silhouettes, key)
    ? silhouettes[key]
    : undefined;
  return silhouette ? (
    <img
      src={`/brand/multi-choice-motors/body-types/bodytype-${silhouette}.svg`}
      alt=""
      aria-hidden="true"
      width={88}
      height={36}
      loading="lazy"
      decoding="async"
      className="multi-body-shape"
      style={{ objectFit: "contain" }}
    />
  ) : (
    <Car
      width={88}
      height={36}
      strokeWidth={1.8}
      aria-hidden="true"
      focusable="false"
      className="multi-body-shape"
    />
  );
}
