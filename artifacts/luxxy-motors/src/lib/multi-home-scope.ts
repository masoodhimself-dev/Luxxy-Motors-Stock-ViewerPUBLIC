import { publicDealershipOrigin } from "./public-dealership-url";

/** Branding belongs to this resolved website, never to an editable dealer name. */
export function isMultiChoiceWebsite(
  doc?: Pick<Document, "querySelector" | "location">,
): boolean {
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

/** The homepage layout stays separate from the website-wide logo choice. */
export function isMultiChoiceHomepage(
  location: string,
  doc?: Pick<Document, "querySelector" | "location">,
): boolean {
  return location === "/" && isMultiChoiceWebsite(doc);
}
