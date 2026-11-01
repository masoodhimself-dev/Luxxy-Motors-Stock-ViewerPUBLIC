import { isUKNumberPlate } from '@workspace/vehicle-meta';
import { normaliseExchangeRegistration, updatePartExchangeAnswer } from './part-exchange-autofill';
import { partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft } from './part-exchange-draft';
import type { PartExchangeDetails } from './part-exchange';
import type { PartExchangeMotDetailsResult } from './part-exchange-lookup';
import { publicDealershipOrigin } from './public-dealership-url';

const handoffLifetime = 5 * 60_000;
type HomepageHandoff = { scope: string; savedAt: number; registration: string; result?: PartExchangeMotDetailsResult };
let handoff: HomepageHandoff | null = null;
let intentVersion = 0;
const scope = () => `${window.location.origin}|${publicDealershipOrigin()}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** Live lookup facts never enter storage or the URL. A short, same-tab handoff
 * is bound to both this origin and the shell's canonical dealership. */
export function clearHomepagePartExchangeLookup() { handoff = null; intentVersion += 1; }
/** Shared by both homepage forms: the latest explicit car intent wins. */
export function homepagePartExchangeIntentVersion() { return intentVersion; }
export function retainHomepagePartExchangeLookup(result: PartExchangeMotDetailsResult) {
  handoff = { scope: scope(), savedAt: Date.now(), registration: normaliseExchangeRegistration(result.registration), result: clone(result) };
}
function currentHandoff() {
  if (handoff && (handoff.scope !== scope() || handoff.savedAt > Date.now() || Date.now() - handoff.savedAt > handoffLifetime)) handoff = null;
  return handoff;
}
export function readHomepagePartExchangeRegistration(): string | null {
  return currentHandoff()?.registration ?? null;
}
export function readHomepagePartExchangeLookup(registration: string): PartExchangeMotDetailsResult | null {
  const saved = currentHandoff();
  return saved?.result && saved.registration === normaliseExchangeRegistration(registration) ? clone(saved.result) : null;
}

/** Carry explicit answers into the existing draft. No MOT facts or verified
 * gate are persisted. Memory carries the plate if browser storage is blocked. */
export function prepareHomepagePartExchange(value: string): boolean {
  const registration = normaliseExchangeRegistration(value);
  if (registration.length > 20 || !isUKNumberPlate(registration)) return false;
  if (currentHandoff()?.registration !== registration) handoff = { scope: scope(), savedAt: Date.now(), registration };
  const key = partExchangeDraftKey(), previous = readPartExchangeDraft(key);
  const empty: PartExchangeDetails = { registration: '', makeModel: '', mileage: '', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '', name: '', phone: '', email: '' };
  const answers = updatePartExchangeAnswer({ details: previous?.details ?? empty, autofill: previous?.autofill }, 'registration', registration);
  savePartExchangeDraft(key, {
    ...answers,
    vehicleId: previous?.vehicleId ?? '',
    delivery: previous?.delivery ?? 'website',
    ...(previous?.message ? { message: previous.message } : {}),
  });
  return true;
}
