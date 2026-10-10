import { useEffect, useState, type CSSProperties } from "react";
import { invoicePalette } from "@workspace/vehicle-meta";
import type {
  SaleWorkspaceDocument,
  SaleWorkspaceBranding,
  SaleWorkspaceDraft,
  SaleWorkspaceTotals,
} from "@workspace/vehicle-meta";
import type { DealerConfig } from "@/config/dealer";
import type { Car } from "@/lib/stock-context";
import { formatPhoneDisplay } from "@/lib/utils";
import { DealerWordmark } from "@/components/brand/wordmark";
import {
  exchanges,
  payments,
  pence,
  totals,
  saleStaffLabel,
  type SaleDraft,
} from "./model";
import "./sales-document.css";

function documentAttributes(branding: SaleWorkspaceBranding) {
  return { 'data-design': branding.invoiceSettings?.style ?? 'modern', 'data-logo-size': branding.invoiceSettings?.logoSize ?? 'medium', 'data-ink-saving': branding.invoiceSettings?.inkSaving ? 'true' : 'false' };
}
function DocumentExtras({ branding }: { branding: SaleWorkspaceBranding }) {
  return <>{branding.invoiceSettings?.paymentInstructions && <section className="invoice-payment-instructions"><h3>Payment instructions</h3><p className="invoice-multiline">{branding.invoiceSettings.paymentInstructions}</p></section>}{branding.invoiceSettings?.footer && <p className="invoice-custom-footer invoice-multiline">{branding.invoiceSettings.footer}</p>}</>;
}
function documentColours(accent?: string | null): CSSProperties {
  const palette = invoicePalette(accent);
  return Object.fromEntries(Object.entries(palette).map(([key, value]) => [`--invoice-${key}`, value])) as CSSProperties;
}

const money = (value: number) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format((value || 0) / 100)
    : "—";

function supplied(value?: string | null) {
  const text = value?.trim() ?? "";
  return /^(unknown|n\/a|not supplied|not provided|your dealership|your address|enter .+|\[.+\])$|\b(?:sample (?:address|postcode|phone|email)|example (?:road|street|address)|placeholder)\b/i.test(
    text,
  )
    ? ""
    : text;
}

function dateLabel(value: string) {
  // Date-only sales fields have no timezone; validate rather than rolling an invalid date forward.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      }).format(date)
    : value;
}

type SalesDocumentProps =
  | {
      issuedDocument: SaleWorkspaceDocument;
      draft?: SaleDraft;
      dealer?: DealerConfig;
      vehicle?: Car;
      documentType?: "Sales invoice" | "Deposit receipt";
    }
  | {
      issuedDocument?: undefined;
      draft: SaleDraft;
      dealer: DealerConfig;
      vehicle?: Car;
      documentType: "Sales invoice" | "Deposit receipt";
    };

export const salesDocumentTitle = (document: SaleWorkspaceDocument) =>
  document.title;

/** Rendering has no payment side effects. Issued documents read only their saved snapshot. */
export function SalesDocument(props: SalesDocumentProps) {
  return props.issuedDocument ? (
    <IssuedSalesDocument document={props.issuedDocument} />
  ) : (
    <DraftSalesDocument
      draft={props.draft}
      dealer={props.dealer}
      vehicle={props.vehicle}
      documentType={props.documentType}
    />
  );
}

function DraftSalesDocument({
  draft,
  dealer,
  vehicle,
  documentType,
}: {
  draft: SaleDraft;
  dealer: DealerConfig;
  vehicle?: Car;
  documentType: "Sales invoice" | "Deposit receipt";
}) {
  const amount = totals(draft);
  const exchangeRows = exchanges(draft);
  const paymentRows = payments(draft);
  const receipt = documentType === "Deposit receipt";
  const hasConfirmedPayments = paymentRows.some(
    (row) => row.status === "confirmed",
  );
  const legacyDemo = draft.id.startsWith("DEMO-");
  const [failedLogo, setFailedLogo] = useState(false);
  useEffect(() => setFailedLogo(false), [dealer.identity.logoAsset]);
  const name = supplied(dealer.identity.name);
  const address = [
    dealer.address?.street,
    dealer.address?.city,
    dealer.address?.region,
    dealer.address?.postcode,
  ]
    .map(supplied)
    .filter(Boolean);
  const phone = supplied(dealer.contact.phone);
  const email = supplied(dealer.contact.email);
  const printedEmail =
    /@(?:example\.(?:com|org|net)|[^@]+\.(?:test|invalid))$/i.test(email)
      ? ""
      : email;
  const companyName = supplied(dealer.legal.companyName);
  const companyNumber = supplied(dealer.legal.companyNumber);
  const vatNumber = supplied(dealer.legal.vatNumber);
  const preparedDate = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date());
  const vehicleFacts = [
    vehicle?.year ? ["Year", String(vehicle.year)] : null,
    supplied(vehicle?.fuel) ? ["Fuel", supplied(vehicle?.fuel)] : null,
    supplied(vehicle?.transmission)
      ? ["Transmission", supplied(vehicle?.transmission)]
      : null,
    typeof vehicle?.mileage === "number" &&
    Number.isFinite(vehicle.mileage) &&
    vehicle.mileage >= 0
      ? [
          "Listed mileage",
          `${new Intl.NumberFormat("en-GB").format(vehicle.mileage)} miles`,
        ]
      : null,
  ].filter((fact): fact is string[] => fact !== null);

  return (
    <article
      className="sales-document invoice-sheet"
      aria-label={`${documentType} preview`}
      {...documentAttributes(dealer as SaleWorkspaceBranding)}
      style={documentColours(dealer.presentation?.linkColour)}
    >
      <header className="invoice-header">
        <div className="invoice-dealer">
          {(dealer as SaleWorkspaceBranding).invoiceSettings?.showLogo !== false && dealer.identity.logoAsset && !failedLogo ? (
            <img
              className="invoice-logo"
              src={dealer.identity.logoAsset}
              alt={name}
              onError={() => setFailedLogo(true)}
            />
          ) : (dealer as SaleWorkspaceBranding).invoiceSettings?.showLogo !== false ? (
            <DealerWordmark
              name={name}
              logoText={supplied(dealer.identity.logoText)}
              className="invoice-wordmark"
            />
          ) : null}
          {name && <p className="invoice-dealer-name">{name}</p>}
          {address.length > 0 && (
            <p className="invoice-dealer-address">{address.join(", ")}</p>
          )}
        </div>
        <div className="invoice-heading">
          <span className="invoice-draft-label">Draft preview</span>
          <h2>{documentType}</h2>
          <dl className="invoice-reference">
            <div>
              <dt>Reference</dt>
              <dd>{draft.id}</dd>
            </div>
            <div>
              <dt>Prepared</dt>
              <dd>{preparedDate}</dd>
            </div>
          </dl>
        </div>
      </header>

      <aside className="invoice-preview-notice">
        <strong>
          {hasConfirmedPayments
            ? "DRAFT — NOT ISSUED · PAYMENTS RECORDED BY STAFF"
            : legacyDemo
              ? "DEMO — NOT ISSUED · NO PAYMENT RECEIVED"
              : "DRAFT — NOT ISSUED · NO CONFIRMED PAYMENTS"}
        </strong>
        <span>
          {hasConfirmedPayments
            ? "For review only. Confirmed payments are recorded on the sale; this invoice preview has not been issued."
            : legacyDemo
              ? "For review only. Amounts below are entries in a local sales draft."
              : "For review only. This invoice has not been issued and is not a payment receipt."}
        </span>
      </aside>

      <div className="invoice-parties">
        {(draft.customer || draft.address || draft.email || draft.phone) && (
          <section className="invoice-customer">
            <h3>Prepared for</h3>
            {draft.customer && (
              <p className="invoice-customer-name">{draft.customer}</p>
            )}
            {draft.address && (
              <p className="invoice-multiline">{draft.address}</p>
            )}
            {(draft.email || draft.phone) && (
              <div className="invoice-customer-contact">
                {draft.email && <p>{draft.email}</p>}
                {draft.phone && <p>{formatPhoneDisplay(draft.phone)}</p>}
              </div>
            )}
          </section>
        )}
        {(draft.vehicle ||
          vehicleFacts.length > 0 ||
          draft.registration ||
          draft.collection) && (
          <section className="invoice-vehicle">
            <h3>Vehicle details</h3>
            {draft.vehicle && (
              <p className="invoice-vehicle-name">{draft.vehicle}</p>
            )}
            {draft.registration && (
              <p className="invoice-registration">
                <span>Registration</span>
                <strong>{draft.registration.toUpperCase()}</strong>
              </p>
            )}
            {vehicleFacts.length > 0 && (
              <dl className="invoice-vehicle-facts">
                {vehicleFacts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {draft.collection && (
              <p className="invoice-collection">
                Planned collection · {dateLabel(draft.collection)}
              </p>
            )}
          </section>
        )}
      </div>

      <section className="invoice-section">
        <div className="invoice-section-heading">
          <h3>Sale breakdown</h3>
          <span>All amounts in GBP</span>
        </div>
        <table className="invoice-items" aria-label="Sale breakdown">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className="invoice-entry-type">
                Item
              </th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {draft.vehicle && <strong>{draft.vehicle}</strong>}
                {draft.registration && (
                  <small>{draft.registration.toUpperCase()}</small>
                )}
              </td>
              <td className="invoice-entry-type">Vehicle</td>
              <td>{money(amount.price)}</td>
            </tr>
            {(draft.adjustments ?? []).map((row, i) => (
              <tr key={i}>
                <td>{row.description}</td>
                <td className="invoice-entry-type">
                  {row.kind === "discount" ? "Discount" : "Fee"}
                </td>
                <td>
                  {money(
                    pence(row.amount) * (row.kind === "discount" ? -1 : 1),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {exchangeRows.length > 0 && (
        <section className="invoice-section invoice-exchange-section">
          <div className="invoice-section-heading">
            <h3>Part-exchange allowance</h3>
            <span>
              {exchangeRows.length}{" "}
              {exchangeRows.length === 1 ? "vehicle" : "vehicles"}
            </span>
          </div>
          <table
            className="invoice-exchanges"
            aria-label="Part-exchange allowance"
          >
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Registration</th>
                <th scope="col">Allowance</th>
              </tr>
            </thead>
            <tbody>
              {exchangeRows.map((row, i) => (
                <tr key={i}>
                  <td>{row.description}</td>
                  <td>{row.registration.toUpperCase()}</td>
                  <td>{money(pence(row.value))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div
        className={`invoice-settlement${paymentRows.length > 5 ? " invoice-settlement-long" : ""}`}
      >
        {paymentRows.length > 0 ? (
          <section className="invoice-section invoice-payment-section">
            <div className="invoice-section-heading">
              <h3>Payment entries</h3>
              <span>
                {hasConfirmedPayments
                  ? "Recorded on sale · draft document"
                  : "Illustrative · unconfirmed"}
              </span>
            </div>
            <table className="invoice-payments" aria-label="Payment entries">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Method / reference</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.date && dateLabel(row.date)}</td>
                    <td>
                      {row.method}
                      {row.reference && <small>{row.reference}</small>}
                      {row.status === "pending" && (
                        <small>Pending · not received</small>
                      )}
                    </td>
                    <td>{money(pence(row.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <div className="invoice-settlement-context">
            <h3>{receipt ? "Payment summary" : "Your sale at a glance"}</h3>
            <p>
              {receipt
                ? "This preview summarises the payment entries against the vehicle."
                : "Charges, allowances and payment entries are brought together here."}
            </p>
            {draft.collection && (
              <p className="invoice-settlement-collection">
                Planned collection
                <br />
                <strong>{dateLabel(draft.collection)}</strong>
              </p>
            )}
          </div>
        )}
        <div className="invoice-summary" data-balance={amount.balance === 0 ? "settled" : amount.balance < 0 ? "credit" : "outstanding"}>
          <dl className="invoice-totals">
            <div>
              <dt>Total sale price</dt>
              <dd>{money(amount.price + amount.adjustments)}</dd>
            </div>
            {exchangeRows.length > 0 && (
              <div>
                <dt>Part-exchange allowance</dt>
                <dd>{money(-amount.allowance)}</dd>
              </div>
            )}
            {paymentRows.length > 0 && (
              <div>
                <dt>Payments entered</dt>
                <dd>{money(-amount.deposit)}</dd>
              </div>
            )}
          </dl>
          <div className="invoice-balance">
            <span>
              {receipt
                ? "Payments entered · preview"
                : "Preview balance remaining"}
            </span>
            <strong>{money(receipt ? amount.deposit : amount.balance)}</strong>
            {receipt && (
              <small>Balance remaining {money(amount.balance)}</small>
            )}
          </div>
        </div>
      </div>

      {draft.notes.trim() && (
        <section className="invoice-notes">
          <h3>Agreed notes</h3>
          <p className="invoice-multiline">{draft.notes}</p>
        </section>
      )}
      {receipt && (
        <p className="invoice-receipt-note">
          Receipt layout preview only. A real receipt will be issued only after
          payment is confirmed.
        </p>
      )}

      <footer className="invoice-footer">
      <DocumentExtras branding={dealer as SaleWorkspaceBranding} />
        {(phone || printedEmail) && (
          <p className="invoice-contact">
            {phone && <span>{formatPhoneDisplay(phone)}</span>}
            {printedEmail && <span>{printedEmail}</span>}
          </p>
        )}
        {(companyNumber ||
          vatNumber ||
          (companyName && companyName !== name)) && (
          <p className="invoice-legal">
            {[
              companyName && companyName !== name ? companyName : "",
              companyNumber ? `Company no. ${companyNumber}` : "",
              vatNumber ? `VAT registration ${vatNumber}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        <p>
          Design preview only. Tax treatment and dealership terms are not
          configured. Not a VAT invoice or proof of purchase.
        </p>
        <div className="invoice-footer-reference">
          <span>{name}</span>
          <span>{draft.id} · Draft</span>
        </div>
      </footer>
    </article>
  );
}

function issuedDateLabel(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateLabel(value);
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      }).format(date)
    : supplied(value);
}

function DocumentDealer({ branding }: { branding: SaleWorkspaceBranding }) {
  const [failedLogo, setFailedLogo] = useState(false);
  const name = supplied(branding.identity.name);
  useEffect(() => setFailedLogo(false), [branding.identity.logoAsset]);
  const address = Object.values({
    street: branding.address?.street,
    city: branding.address?.city,
    region: branding.address?.region,
    postcode: branding.address?.postcode,
  })
    .map(supplied)
    .filter(Boolean);
  return (
    <div className="invoice-dealer">
      {branding.invoiceSettings?.showLogo !== false && supplied(branding.identity.logoAsset) && !failedLogo ? (
        <img
          className="invoice-logo"
          src={branding.identity.logoAsset}
          alt={name}
          onError={() => setFailedLogo(true)}
        />
      ) : branding.invoiceSettings?.showLogo !== false ? (
        <DealerWordmark
          name={name}
          logoText={supplied(branding.identity.logoText)}
          className="invoice-wordmark"
        />
      ) : null}
      {name && <p className="invoice-dealer-name">{name}</p>}
      {address.length > 0 && (
        <p className="invoice-dealer-address">{address.join(", ")}</p>
      )}
    </div>
  );
}

function IssuedDocumentParties({
  document,
}: {
  document: SaleWorkspaceDocument;
}) {
  const { draft, vehicle } = document.snapshot;
  const vehicleFacts = [
    vehicle?.year ? ["Year", String(vehicle.year)] : null,
    supplied(vehicle?.fuel) ? ["Fuel", supplied(vehicle?.fuel)] : null,
    supplied(vehicle?.transmission)
      ? ["Transmission", supplied(vehicle?.transmission)]
      : null,
    typeof vehicle?.mileage === "number" &&
    Number.isFinite(vehicle.mileage) &&
    vehicle.mileage >= 0
      ? [
          "Listed mileage",
          `${new Intl.NumberFormat("en-GB").format(vehicle.mileage)} miles`,
        ]
      : null,
  ].filter((fact): fact is string[] => fact !== null);
  const customer = supplied(draft.customer);
  const address = supplied(draft.address);
  const phone = supplied(draft.phone);
  const email = supplied(draft.email);
  const vehicleName = supplied(draft.vehicle) || supplied(vehicle?.title);
  const registration = supplied(draft.registration);
  return (
    <div className="invoice-parties">
      {(customer || address || phone || email) && (
        <section className="invoice-customer">
          <h3>{document.type === "receipt" ? "Customer" : "Issued to"}</h3>
          {customer && <p className="invoice-customer-name">{customer}</p>}
          {address && <p className="invoice-multiline">{address}</p>}
          {(email || phone) && (
            <div className="invoice-customer-contact">
              {email && <p>{email}</p>}
              {phone && <p>{formatPhoneDisplay(phone)}</p>}
            </div>
          )}
        </section>
      )}
      {(vehicleName || registration || vehicleFacts.length > 0) && (
        <section className="invoice-vehicle">
          <h3>Vehicle details</h3>
          {vehicleName && <p className="invoice-vehicle-name">{vehicleName}</p>}
          {registration && (
            <p className="invoice-registration">
              <span>Registration</span>
              <strong>{registration.toUpperCase()}</strong>
            </p>
          )}
          {vehicleFacts.length > 0 && (
            <dl className="invoice-vehicle-facts">
              {vehicleFacts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {!draft.fulfilment && draft.collection && (
            <p className="invoice-collection">
              Planned collection · {dateLabel(draft.collection)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function IssuedSaleBreakdown({
  draft,
  amount,
}: {
  draft: SaleWorkspaceDraft;
  amount: SaleWorkspaceTotals;
}) {
  const exchangeRows = exchanges(draft);
  return (
    <>
      <section className="invoice-section">
        <div className="invoice-section-heading">
          <h3>Sale breakdown</h3>
          <span>All amounts in GBP</span>
        </div>
        <table className="invoice-items" aria-label="Sale breakdown">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className="invoice-entry-type">
                Item
              </th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {supplied(draft.vehicle) && <strong>{draft.vehicle}</strong>}
                {supplied(draft.registration) && (
                  <small>{draft.registration.toUpperCase()}</small>
                )}
              </td>
              <td className="invoice-entry-type">Vehicle</td>
              <td>{money(amount.price)}</td>
            </tr>
            {(draft.adjustments ?? []).map((row, index) => (
              <tr key={index}>
                <td>{supplied(row.description)}</td>
                <td className="invoice-entry-type">
                  {row.kind === "discount" ? "Discount" : "Fee"}
                </td>
                <td>
                  {money(
                    pence(row.amount) * (row.kind === "discount" ? -1 : 1),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {exchangeRows.length > 0 && (
        <section className="invoice-section invoice-exchange-section">
          <div className="invoice-section-heading">
            <h3>Part-exchange allowance</h3>
            <span>
              {exchangeRows.length}{" "}
              {exchangeRows.length === 1 ? "vehicle" : "vehicles"}
            </span>
          </div>
          <table
            className="invoice-exchanges"
            aria-label="Part-exchange allowance"
          >
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Registration</th>
                <th scope="col">Allowance</th>
              </tr>
            </thead>
            <tbody>
              {exchangeRows.map((row, index) => (
                <tr key={index}>
                  <td>{supplied(row.description)}</td>
                  <td>{supplied(row.registration).toUpperCase()}</td>
                  <td>{money(pence(row.value))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function IssuedBalanceSummary({
  document,
}: {
  document: SaleWorkspaceDocument;
}) {
  const amount = document.snapshot.totals;
  return (
    <div className="invoice-summary" data-balance={document.balanceAtIssue === 0 ? "settled" : document.balanceAtIssue < 0 ? "credit" : "outstanding"}>
      <dl className="invoice-totals">
        <div>
          <dt>Total sale price</dt>
          <dd>{money(amount.price + amount.adjustments)}</dd>
        </div>
        {amount.allowance > 0 && (
          <div>
            <dt>Part-exchange allowance</dt>
            <dd>{money(-amount.allowance)}</dd>
          </div>
        )}
        <div>
          <dt>Total due after allowances</dt>
          <dd>{money(amount.totalDue)}</dd>
        </div>
        <div>
          <dt>Total received at issue</dt>
          <dd>{money(amount.confirmedPaid)}</dd>
        </div>
        {amount.pending > 0 && (
          <div className="invoice-pending-total">
            <dt>Pending · not deducted</dt>
            <dd>{money(amount.pending)}</dd>
          </div>
        )}
      </dl>
      <div className="invoice-balance">
        <span>
          {document.balanceAtIssue < 0
            ? "Customer credit at issue"
            : "Balance remaining at issue"}
        </span>
        <strong>{money(Math.abs(document.balanceAtIssue))}</strong>
        {document.balanceAtIssue === 0 && <small>Balance paid in full</small>}
      </div>
    </div>
  );
}

function IssuedFulfilment({
  draft,
  handover = false,
}: {
  draft: SaleWorkspaceDraft;
  handover?: boolean;
}) {
  const fulfilment = draft.fulfilment;
  if (!fulfilment) return null;
  const delivered = fulfilment.method === "delivery";
  const entries = [
    ["Arrangement", delivered ? "Delivery" : "Showroom collection"],
    [
      "Vehicle viewed",
      fulfilment.viewed === "viewed"
        ? "Viewed before handover"
        : "Not yet viewed",
    ],
    delivered && supplied(fulfilment.address)
      ? ["Delivery address", fulfilment.address]
      : null,
    supplied(fulfilment.recipient) ? ["Recipient", fulfilment.recipient] : null,
    supplied(fulfilment.phone)
      ? ["Contact", formatPhoneDisplay(fulfilment.phone)]
      : null,
    fulfilment.scheduledDate
      ? ["Planned date", dateLabel(fulfilment.scheduledDate)]
      : null,
    supplied(fulfilment.timeWindow)
      ? ["Time window", fulfilment.timeWindow]
      : null,
    handover && fulfilment.completedAt
      ? [
          delivered ? "Delivered" : "Collected",
          issuedDateLabel(fulfilment.completedAt),
        ]
      : null,
    handover && supplied(fulfilment.completedRecipient)
      ? ["Received by", fulfilment.completedRecipient!]
      : null,
    handover && supplied(fulfilment.completedBy)
      ? ["Recorded by", saleStaffLabel(fulfilment.completedBy)]
      : null,
  ].filter((entry): entry is string[] => entry !== null);
  return (
    <section
      className={`invoice-fulfilment${handover ? " invoice-handover-details" : ""}`}
    >
      <h3>
        {handover
          ? delivered
            ? "Delivery confirmation"
            : "Collection confirmation"
          : "Collection & delivery arrangements"}
      </h3>
      <dl>
        {entries.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="invoice-multiline">{value}</dd>
          </div>
        ))}
      </dl>
      {supplied(fulfilment.instructions) && (
        <p className="invoice-multiline">{fulfilment.instructions}</p>
      )}
    </section>
  );
}

function IssuedDocumentFooter({
  document,
}: {
  document: SaleWorkspaceDocument;
}) {
  const branding = document.snapshot.branding;
  const name = supplied(branding.identity.name);
  const phone = supplied(branding.contact.phone);
  const email = supplied(branding.contact.email);
  const printedEmail =
    /@(?:example\.(?:com|org|net)|[^@]+\.(?:test|invalid))$/i.test(email)
      ? ""
      : email;
  const companyName = supplied(branding.legal.companyName);
  const companyNumber = supplied(branding.legal.companyNumber);
  const vatNumber = supplied(branding.legal.vatNumber);
  return (
    <footer className="invoice-footer">
      <DocumentExtras branding={branding} />
      {(phone || printedEmail) && (
        <p className="invoice-contact">
          {phone && <span>{formatPhoneDisplay(phone)}</span>}
          {printedEmail && <span>{printedEmail}</span>}
        </p>
      )}
      {(companyNumber ||
        vatNumber ||
        (companyName && companyName !== name)) && (
        <p className="invoice-legal">
          {[
            companyName !== name ? companyName : "",
            companyNumber ? `Company no. ${companyNumber}` : "",
            vatNumber ? `VAT registration ${vatNumber}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <p>
        {document.type === "receipt"
          ? "This receipt records the individual payment shown above. The balance reflects the sale when this document was issued."
          : document.type === "statement"
            ? "This statement records the sale balance at the date shown. Pending payments do not reduce the balance."
            : document.type === "handover"
              ? "Handover and payment status are recorded separately. Any outstanding balance is shown above."
              : ["terms", "reservation"].includes(document.type)
                ? "This document preserves the approved wording and sale details at the time of issue."
                : document.type === "vehicle-details"
                  ? "This record contains supplied vehicle information at the time of issue."
                  : "This invoice records the agreed sale details at issue. Separate receipts record payments received."}
      </p>
      <p>Issued by showroom staff.</p>
      <div className="invoice-footer-reference">
        <span>{name}</span>
        <span>
          {document.number} · {document.snapshot.draft.id}
        </span>
      </div>
    </footer>
  );
}

function IssuedSalesDocument({
  document,
}: {
  document: SaleWorkspaceDocument;
}) {
  const { draft, branding, totals: amount } = document.snapshot;
  if (["terms", "reservation", "vehicle-details"].includes(document.type))
    return (
      <article
        className="sales-document invoice-sheet invoice-issued"
        aria-label={document.title}
        {...documentAttributes(branding)}
      style={documentColours(branding.presentation?.linkColour)}
      >
        <header className="invoice-header">
          <div>
            <h2>{branding.identity.name}</h2>
            <p>
              {document.number} · {draft.id}
            </p>
          </div>
          <div>
            <h1>{document.title}</h1>
            <p>
              Issued {new Date(document.issuedAt).toLocaleDateString("en-GB")}
            </p>
          </div>
        </header>
        <section className="invoice-parties">
          <div>
            <h3>Customer</h3>
            <p>{draft.customer}</p>
            <p className="whitespace-pre-line">{draft.address}</p>
          </div>
          <div>
            <h3>Vehicle</h3>
            <p>{draft.vehicle}</p>
            {draft.registration && <p>{draft.registration}</p>}
          </div>
        </section>
        {document.content && (
          <section className="invoice-terms-body whitespace-pre-wrap">
            {document.content}
          </section>
        )}
        {document.type === "vehicle-details" && (
          <section className="invoice-terms-body">
            <h3>Supplied vehicle facts</h3>
            {Object.entries(document.snapshot.vehicle ?? {})
              .filter(
                ([key, value]) => key !== "id" && value != null && value !== "",
              )
              .map(([key, value]) => (
                <p key={key}>
                  <strong>{key.replace(/([A-Z])/g, " $1")}: </strong>
                  {String(value)}
                </p>
              ))}
            {draft.notes && (
              <p className="whitespace-pre-wrap">{draft.notes}</p>
            )}
          </section>
        )}
        <p className="invoice-terms-body">
          Total due: {money(amount.totalDue)} · Balance at issue:{" "}
          {money(document.balanceAtIssue)}
        </p>
        {["terms", "reservation"].includes(document.type) && (
          <section className="invoice-terms-body">
            <p>Customer signature: ____________________ Date: __________</p>
            <p>Dealer signature: ____________________ Date: __________</p>
          </section>
        )}
        <IssuedDocumentFooter document={document} />
      </article>
    );
  const receipt = document.type === "receipt";
  const statement = document.type === "statement";
  const handover = document.type === "handover";
  const payment = receipt
    ? document.snapshot.payments.find(
        (row) => row.id === document.paymentId && row.status === "confirmed",
      )
    : undefined;
  const adjustmentReceipt =
    payment?.kind === "refund" ||
    payment?.kind === "reversal" ||
    payment?.kind === "refund-correction";
  const confirmedPayments = document.snapshot.payments.filter(
    (row) => row.status === "confirmed",
  );
  const pendingPayments = statement
    ? document.snapshot.payments.filter((row) => row.status === "pending")
    : [];
  return (
    <article
      className={`sales-document invoice-sheet invoice-issued${receipt ? " invoice-issued-receipt" : ""}`}
      aria-label={document.title}
      {...documentAttributes(branding)}
      style={documentColours(branding.presentation?.linkColour)}
    >
      <header className="invoice-header">
        <DocumentDealer branding={branding} />
        <div className="invoice-heading">
          <h2>{document.title}</h2>
          <dl className="invoice-reference">
            <div>
              <dt>Document no.</dt>
              <dd>{document.number}</dd>
            </div>
            <div>
              <dt>Sale reference</dt>
              <dd>{draft.id}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{issuedDateLabel(document.issuedAt)}</dd>
            </div>
            {supplied(document.issuedBy) && (
              <div>
                <dt>Issued by</dt>
                <dd>{saleStaffLabel(document.issuedBy)}</dd>
              </div>
            )}
            {document.type === "invoice" && (
              <div>
                <dt>Version</dt>
                <dd>{document.version}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>
      <aside className="invoice-preview-notice invoice-record-notice">
        <strong>
          {receipt
            ? adjustmentReceipt
              ? "Payment adjustment recorded by staff"
              : "Payment recorded by staff"
            : handover
              ? "Handover recorded by staff"
              : statement
                ? "Balance statement at issue"
                : "Agreed sale details at issue"}
        </strong>
        <span>
          {receipt
            ? "This document records the transaction below and keeps the original balance at issue."
            : "A saved document. Later changes to this sale do not change this copy."}
        </span>
      </aside>
      <IssuedDocumentParties document={document} />
      {receipt ? (
        payment ? (
          <section
            className="invoice-payment-receipt"
            aria-label="Receipt payment"
          >
            <div className="invoice-receipt-amount">
              <span>
                {adjustmentReceipt
                  ? payment.kind === "refund"
                    ? "Amount refunded"
                    : payment.kind === "refund-correction"
                      ? "Refund amount restored"
                      : "Payment reversed"
                  : "Payment received"}
              </span>
              <strong>{money(payment.amountPence)}</strong>
              <small>{document.title}</small>
            </div>
            <dl className="invoice-receipt-facts">
              <div>
                <dt>Date</dt>
                <dd>{dateLabel(payment.date)}</dd>
              </div>
              <div>
                <dt>Method</dt>
                <dd>{payment.method}</dd>
              </div>
              {supplied(payment.reference) && (
                <div>
                  <dt>Payment reference</dt>
                  <dd>{payment.reference}</dd>
                </div>
              )}
              <div>
                <dt>Recorded by</dt>
                <dd>{saleStaffLabel(payment.recordedBy)}</dd>
              </div>
              {supplied(payment.reason) && (
                <div>
                  <dt>Reason</dt>
                  <dd>{payment.reason}</dd>
                </div>
              )}
            </dl>
          </section>
        ) : (
          <p className="invoice-receipt-note">
            No confirmed payment is attached to this document.
          </p>
        )
      ) : (
        !handover && <IssuedSaleBreakdown draft={draft} amount={amount} />
      )}
      <div
        className={`invoice-settlement${statement && confirmedPayments.length > 5 ? " invoice-settlement-long" : ""}`}
      >
        {statement ? (
          <section className="invoice-section invoice-payment-section">
            <div className="invoice-section-heading">
              <h3>Confirmed payment history</h3>
              <span>Received payments and adjustments</span>
            </div>
            {confirmedPayments.length > 0 ? (
              <table
                className="invoice-payments"
                aria-label="Confirmed payment history"
              >
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Method / reference</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedPayments.map((row) => (
                    <tr key={row.id}>
                      <td>{dateLabel(row.date)}</td>
                      <td>
                        {row.method}
                        <small>
                          {row.kind === "refund"
                            ? "Refund"
                            : row.kind === "reversal"
                              ? "Reversal"
                              : row.kind === "refund-correction"
                                ? "Refund correction"
                                : row.kind === "deposit"
                                  ? "Deposit"
                                  : row.kind === "final-payment"
                                    ? "Final payment"
                                    : "Part payment"}
                          {supplied(row.reference) && ` · ${row.reference}`}
                        </small>
                        {supplied(row.reason) && <small>{row.reason}</small>}
                      </td>
                      <td>{money(row.signedAmountPence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="invoice-receipt-note">
                No confirmed payments recorded at issue.
              </p>
            )}
          </section>
        ) : (
          <div className="invoice-settlement-context">
            <h3>
              {receipt
                ? "Sale balance at this payment"
                : handover
                  ? "Sale balance at handover"
                  : "Your sale at a glance"}
            </h3>
            <p>
              {receipt
                ? "Keep this receipt with your sale documents. Each further payment has its own receipt."
                : handover
                  ? "The vehicle handover record is shown below."
                  : "The agreed price includes the listed fees and discounts, with part-exchange allowances deducted separately."}
            </p>
          </div>
        )}
        <IssuedBalanceSummary document={document} />
      </div>
      {pendingPayments.length > 0 && (
        <section className="invoice-section invoice-pending-section">
          <div className="invoice-section-heading">
            <h3>Pending payments</h3>
            <span>Unconfirmed · excluded from money received</span>
          </div>
          <table className="invoice-payments" aria-label="Pending payments">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Method / reference</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {pendingPayments.map((row) => (
                <tr key={row.id}>
                  <td>{dateLabel(row.date)}</td>
                  <td>
                    {row.method}
                    {supplied(row.reference) && <small>{row.reference}</small>}
                  </td>
                  <td>{money(row.amountPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {!receipt && <IssuedFulfilment draft={draft} handover={handover} />}
      {!receipt && supplied(draft.notes) && (
        <section className="invoice-notes">
          <h3>Agreed notes</h3>
          <p className="invoice-multiline">{draft.notes}</p>
        </section>
      )}
      <IssuedDocumentFooter document={document} />
    </article>
  );
}
