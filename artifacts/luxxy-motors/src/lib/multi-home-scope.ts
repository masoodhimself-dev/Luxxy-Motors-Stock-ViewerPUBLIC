import { publicDealershipOrigin } from "./public-dealership-url";

/** This presentation belongs to one resolved dealership's homepage only. */
export function isMultiChoiceHomepage(
  location: string,
  doc?: Pick<Document, "querySelector" | "location">,
): boolean {
  if (location !== "/") return false;
  const source =
    doc ?? (typeof document === "undefined" ? undefined : document);
  if (!source) return false;
  try {
    const origin = new URL(publicDealershipOrigin(source));
    return (
      origin.protocol === "https:" &&
      !origin.port &&
      ["multichoicemotors.co.uk", "www.multichoicemotors.co.uk"].includes(
        origin.hostname.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
}
