/** Presentation-only data. All amounts/dates/status labels are formatted by the host. */
export interface Party {
  name?: string | null;
  address?: readonly string[];
  contacts?: readonly string[];
}

export interface ImageAsset {
  /** Already-loaded PNG or JPEG data URL. Never a remote URL. */
  data: string;
  format: 'PNG' | 'JPEG';
}

export interface Vehicle {
  makeModel?: string | null;
  derivative?: string | null;
  registration?: string | null;
  year?: string | null;
  mileage?: string | null;
  fuel?: string | null;
  gearbox?: string | null;
  colour?: string | null;
  vin?: string | null;
  photo?: ImageAsset;
  /** Additional facts from the immutable vehicle snapshot, never inferred. */
  details?: readonly { label: string; value: string }[];
}

export interface SaleLine {
  id: string;
  description: string;
  /** Signed, formatted amount from the application. No arithmetic is performed. */
  amount: string;
}
export interface ConfirmedPayment {
  id: string;
  date: string;
  description: string;
  method: string;
  amount: string;
}
export interface InvoiceData {
  type: 'Deposit Invoice' | 'Sales Invoice';
  number: string;
  issueDate: string;
  dealer: Party;
  customer?: Party;
  vehicle: Vehicle;
  saleLines: readonly SaleLine[];
  /** Pass the existing application's confirmed-payment result in its original order. */
  confirmedPayments: readonly ConfirmedPayment[];
  totals: { saleTotal: string; paymentsReceived: string; balanceRemaining: string };
  /** E.g. Paid in full / Balance outstanding / Deposit received; host decides. */
  settlementStatus?: string;
  balanceLabel?: string;
  pendingNote?: string;
  draft?: boolean;
  paymentInstructions?: readonly string[];
  terms?: readonly string[];
  termsHeading?: string;
  verification?: { url: string; explanation: string; heading?: string };
  /** Exact company/VAT identifiers or other supplied footer lines. Nothing is invented. */
  footerLines?: readonly string[];
}
export interface FontAssets {
  /** Base64 encoded TTF bytes (without a data-URL prefix). */
  regularTtf: string;
  boldTtf: string;
  plateTtf: string;
}
export interface Branding {
  logo?: ImageAsset;
  logoWidth?: number;
  logoHeight?: number;
  /** Approved defaults; map these to the existing dealership brand tokens. */
  ink?: string;
  accent?: string;
  muted?: string;
  rule?: string;
}
export interface RenderOptions {
  fonts: FontAssets;
  branding?: Branding;
  /** Receives the original input. Its result is used verbatim. No uppercase-only fallback. */
  registrationFormatter?: (raw: string) => string | null | undefined;
  /** Neutral vector palette. Supply grayscale photo/logo assets for a fully grayscale PDF. */
  monochrome?: boolean;
  /** Optional stable metadata date supplied by the calling application. */
  creationDate?: Date;
  fileId?: string;
}
export interface LayoutEvent {
  kind: 'text' | 'image' | 'payment' | 'sale-line' | 'settlement' | 'qr';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
  id?: string;
  continued?: boolean;
}
