import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { defaultSaleTerms, saleWorkspaceBranding, type InvoiceDetails, type SalesPaperwork } from "@workspace/vehicle-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import "./integration-settings.css";

type Paperwork = SalesPaperwork & { revision: number };
const fields: Array<[keyof InvoiceDetails, string]> = [
  ["name", "Dealership name"], ["companyName", "Legal business name"],
  ["companyNumber", "Company number"], ["vatNumber", "VAT number"],
  ["street", "Street address"], ["city", "City"], ["region", "County / region"],
  ["postcode", "Postcode"], ["phone", "Contact phone"], ["email", "Contact email"],
];

export function SalesPaperworkSettings() {
  const [value, setValue] = useState<Paperwork>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError(""); setMessage("");
    try {
      const [paperwork, config] = await Promise.all([
        customFetch<Paperwork>("/api/dealer-integrations/sales-paperwork"),
        customFetch<unknown>("/api/dealer-settings"),
      ]);
      const b = saleWorkspaceBranding(config);
      setValue({ ...paperwork, invoiceDetails: {
        name: b.identity.name, companyName: b.legal.companyName, companyNumber: b.legal.companyNumber,
        vatNumber: b.legal.vatNumber, street: b.address.street, city: b.address.city,
        region: b.address.region, postcode: b.address.postcode, phone: b.contact.phone, email: b.contact.email,
        ...paperwork.invoiceDetails,
      } });
    } catch { setError("Invoice settings could not be loaded. Please retry."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function save() {
    if (!value) return;
    setBusy(true); setError(""); setMessage("");
    try {
      setValue(await customFetch<Paperwork>("/api/dealer-integrations/sales-paperwork", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: value.revision, saleTerms: value.saleTerms,
          reservationTerms: value.reservationTerms, invoiceDetails: value.invoiceDetails }),
      }));
      setMessage("Invoice settings saved. Existing issued documents keep their original details and terms.");
    } catch { setError("Could not save. Check the details, or reload if these settings changed on another device."); }
    finally { setBusy(false); }
  }
  return <section className="integration-settings" aria-label="Invoice settings">
    <header className="integration-heading"><div><p className="integration-eyebrow">Sales documents</p><h2>Invoice</h2>
      <p>Edit the seller details and terms used on new invoices. Customer, vehicle, price and payment details are edited in each sale file.</p>
    </div></header>
    {error && <p role="alert" className="integration-error">{error}</p>}
    {message && <p role="status" className="integration-notice">{message}</p>}
    {value ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="integration-card border-0">
        <h3>Seller details</h3><p>These details apply to sales documents. Your website details are managed separately.</p>
        <div className="integration-grid">{fields.map(([key, label]) => <div key={key} className="integration-field">
          <label htmlFor={`invoice-${key}`}>{label}</label>
          <Input id={`invoice-${key}`} type={key === "email" ? "email" : "text"} required={key === "name"}
            maxLength={512} value={value.invoiceDetails?.[key] ?? ""}
            onChange={event => setValue({ ...value, invoiceDetails: { ...value.invoiceDetails, [key]: event.target.value } })} />
        </div>)}</div>
        <div className="integration-field"><label htmlFor="invoice-terms">Terms of sale</label>
          <Textarea id="invoice-terms" rows={14} maxLength={20000} value={value.saleTerms}
            onChange={event => setValue({ ...value, saleTerms: event.target.value })} />
          <small>Included on new invoices and the terms document in the sale pack.</small>
          <Button type="button" variant="outline" onClick={() => setValue({ ...value, saleTerms: defaultSaleTerms })}>Use standard terms</Button>
        </div>
        <div className="integration-field"><label htmlFor="invoice-reservation-terms">Reservation and deposit terms</label>
          <Textarea id="invoice-reservation-terms" rows={6} maxLength={20000} value={value.reservationTerms}
            onChange={event => setValue({ ...value, reservationTerms: event.target.value })} />
        </div>
        <div className="integration-actions"><Button type="submit">{busy ? "Saving…" : "Save invoice settings"}</Button>
          <Button type="button" variant="outline" onClick={() => void load()}>Reload saved details</Button></div>
      </fieldset>
    </form> : <Button type="button" disabled={busy} onClick={() => void load()}>{busy ? "Loading invoice settings…" : "Load invoice settings"}</Button>}
  </section>;
}
