/** Presentation-only contract. The host maps marketplace data before calling this package. */
export interface LabelledValue { label: string; value: string }
export interface FeatureHighlight { text: string; /** Mandatory statements are never dropped. */ required?: boolean }
export interface Disclosure { heading?: string; text: string }
export interface VehiclePhoto { src: string; alt?: string }
export interface Dealer {
  name?: string; logoUrl?: string; accentColour?: string;
  phone?: string; email?: string; address?: string | string[]; postcode?: string;
  openingHours?: string; footerNote?: string;
}
export interface Vehicle {
  title: string; variant?: string; year?: string | number; registrationBand?: string;
  registrationNumber?: string; price?: string; priceNote?: string; mileage?: string;
  fuel?: string; transmission?: string; engine?: string; bodyType?: string; colour?: string;
  doors?: string | number; seats?: string | number;
  /** Display only freshly checked MOT data for this exact registration. */
  motSummary?: string; motCheckedDate?: string;
  /** Confirmed vehicle-specific inclusions, retaining their supplied qualifications. */
  includedSummary?: string;
  descriptionSummary?: string;
  descriptionSummaryShort?: string;
  /** Explicit editorial attestation. Without true the short summary is NOT used. */
  shortSummaryPreservesMaterialFacts?: boolean;
  /** These remain visible in full even when the short summary is used. */
  summaryQualifications?: string[];
  /** Pre-prioritised highlights only, not the full catalogue. Mandatory items are always retained. */
  featureHighlights?: (string | FeatureHighlight)[];
  runningCosts?: LabelledValue[];
  historyFacts?: (string | LabelledValue)[];
  disclosures?: (string | Disclosure)[];
  photos?: (string | VehiclePhoto)[];
}
export interface VehicleSheetData {
  dealer?: Dealer; vehicle: Vehicle;
  document: { vehiclePageUrl: string; printedDate?: string };
}
export interface UrlPolicy {
  /** Trusted origin from the active dealership's settings, NOT an arbitrary origin taken from an untrusted advert. */
  dealerWebsiteOrigin: string;
  /** Optional known public vehicle route, e.g. '/vehicle/'. */
  vehiclePathPrefix?: string;
  /** Empty by default. Only explicitly permanent query parameters may be allowed. Tokens are always rejected. */
  permanentQueryKeys?: readonly string[];
}
export interface SheetOptions extends UrlPolicy {
  monochrome?: boolean;
  /** Existing print-only dealer accent override. Both screen proof and PDF use it when supplied. */
  printAccentColour?: string;
  assetTimeoutMs?: number;
}
export interface FitPlan {
  spacing: 'normal' | 'tight'; supportingPhotos: boolean;
  optionalFeatureLimit: number; summary: 'normal' | 'short'; summaryMaxChars?: number;
}
export interface FitDecision { step: string; detail: string }
export interface FitMetrics {
  pageWidthMm: number; pageHeightMm: number;
  flowBottomMm: number; footerTopMm: number; footerBottomMm: number;
  bodyFontPt: number; overflowMm: number; collisions: string[];
}
export interface FitResult {
  status: 'ready' | 'overflow' | 'invalid-data' | 'invalid-url' | 'asset-error' | 'cancelled';
  code?: string; message?: string; plan?: FitPlan; decisions: FitDecision[];
  warnings: string[]; failedAssets: string[];
  metrics?: FitMetrics; photosShown: number; highlightsShown: string[];
  /** The unmodified input URL, only present after successful validation. */
  vehiclePageUrl?: string;
}
export interface LoadedAssets {
  logo?: string;
  photos: { src: string; alt: string; width: number; height: number; originalIndex: number }[];
  warnings: string[]; failedAssets: string[];
}
export interface QrCode { svg: string; sizeMm: number; modules: number; quietZone: 4; payload: string }
