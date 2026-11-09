import {
  normalisePostcode,
  validPostcodeSyntax,
} from "@workspace/vehicle-meta";
import { publicDealershipOrigin } from "./public-dealership-url";
export function deliveryPostcodeScope(showroomPostcode = "") {
  return `dealeros.delivery-postcode.v1:${publicDealershipOrigin()}:${normalisePostcode(showroomPostcode)}`;
}
export function readDeliveryPostcode(scope = deliveryPostcodeScope()): string {
  try {
    const value = sessionStorage.getItem(scope) ?? "";
    return validPostcodeSyntax(value) ? normalisePostcode(value) : "";
  } catch {
    return "";
  }
}
export function rememberDeliveryPostcode(
  value: string,
  scope = deliveryPostcodeScope(),
) {
  try {
    if (validPostcodeSyntax(value))
      sessionStorage.setItem(scope, normalisePostcode(value));
    else sessionStorage.removeItem(scope);
  } catch {
    /* Private browsing still supports the current form. */
  }
}
