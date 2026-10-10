import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { defaultInvoiceSettings, invoiceBranding, saleWorkspaceBranding, saleWorkspaceNumber, type InvoiceSettings } from '@workspace/vehicle-meta';
import { SalesDocument } from './sales-demo/sales-document';
import { emptyDraft } from './sales-demo/model';
import type { DealerConfig } from '@/config/dealer';
import './invoice-settings.css';
type Paperwork = {
  invoiceSettings?: InvoiceSettings;
  revision: number;
  saleTerms: string;
  reservationTerms: string;
};
export function SalesPaperworkSettings() {
  const [dealer, setDealer] = useState<DealerConfig>();
  useEffect(() => { void customFetch<DealerConfig>('/api/dealer-settings').then(setDealer).catch(() => {}); }, []);
  const [value, setValue] = useState<Paperwork>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Paperwork>();
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await customFetch<Paperwork>("/api/dealer-integrations/sales-paperwork");
      setValue(result); setSaved(result);
    } catch { setError("Sales paperwork could not be loaded. Try again."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    if (!value || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = (
        await customFetch<Paperwork>(
          "/api/dealer-integrations/sales-paperwork",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: value.revision,
              saleTerms: value.saleTerms,
              reservationTerms: value.reservationTerms,
              ...(value.invoiceSettings ? { invoiceSettings: value.invoiceSettings } : {}),
            }),
          },
        )
      );
      setValue(result); setSaved(result);
      setMessage(
        "Document settings saved. Existing issued documents keep their original design, reference and terms.",
      );
    } catch {
      setError(
        "Could not save. Reload if these settings changed on another device.",
      );
    } finally {
      setBusy(false);
    }
  }
  const changed = Boolean(value && saved && (value.saleTerms !== saved.saleTerms || value.reservationTerms !== saved.reservationTerms || JSON.stringify(value.invoiceSettings) !== JSON.stringify(saved.invoiceSettings)));
  const options = { ...defaultInvoiceSettings, ...value?.invoiceSettings };
  const change = <K extends keyof InvoiceSettings>(key: K, next: InvoiceSettings[K]) => value && setValue({ ...value, invoiceSettings: { ...options, [key]: next } });
  const sampleReference = saleWorkspaceNumber({}, 'invoice', new Date().toISOString(), options);
  const previewDealer = invoiceBranding(saleWorkspaceBranding(dealer), options) as DealerConfig;
  const sample = { ...emptyDraft(), id: 'DESIGN-SAMPLE', customer: 'Example customer', vehicle: 'Example vehicle', price: '12995', registration: '', notes: '' };
  return (
    <section className="integration-card" aria-label="Sales paperwork settings">
      <h3>Sales paperwork</h3>
      <p>
        Paste your approved dealership wording. Taking a deposit and completing
        a sale save a dated copy with the customer’s document pack.
      </p>
      <p className="integration-footnote">These terms are stored with staff-issued documents. The customer website’s online reservation terms are configured separately in Website → Services.</p>
      {error && <p role="alert" className="integration-error">{error}</p>}
      {value ? (
        <>
          <div className="invoice-settings-layout">
            <div className="invoice-settings-controls">
              <h3>Invoice design & references</h3>
              <label className="integration-field">Design style<select disabled={busy} value={options.style} onChange={e => change('style', e.target.value as InvoiceSettings['style'])}><option value="classic">Classic</option><option value="modern">Modern</option><option value="premium">Premium</option></select></label>
              <label><input type="checkbox" disabled={busy} checked={options.useWebsiteColour} onChange={e => change('useWebsiteColour', e.target.checked)} /> Use website colour</label>
              <label className="integration-field">Invoice colour<input type="color" disabled={busy || options.useWebsiteColour} value={options.accent} onChange={e => change('accent', e.target.value)} /></label>
              <label><input type="checkbox" disabled={busy} checked={options.showLogo} onChange={e => change('showLogo', e.target.checked)} /> Show dealership logo</label>
              <label className="integration-field">Logo size<select disabled={busy} value={options.logoSize} onChange={e => change('logoSize', e.target.value as InvoiceSettings['logoSize'])}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
              <label><input type="checkbox" disabled={busy} checked={options.inkSaving} onChange={e => change('inkSaving', e.target.checked)} /> Ink-saving design</label>
              <label className="integration-field">Thank-you / footer wording<Textarea disabled={busy} rows={2} maxLength={600} value={options.footer} onChange={e => change('footer', e.target.value)} /></label>
              <label className="integration-field">Payment instructions<Textarea disabled={busy} rows={3} maxLength={1200} value={options.paymentInstructions} onChange={e => change('paymentInstructions', e.target.value)} /></label>
              <p>Leave payment instructions blank to omit them. Enter only this dealership’s verified payment details.</p>
              <label className="integration-field">Dealer reference prefix<input disabled={busy} maxLength={12} pattern="[A-Z0-9]*" value={options.referencePrefix} onChange={e => change('referencePrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
              <label className="integration-field">Starting sequence (minimum)<input disabled={busy} type="number" min={1} max={999999999} step={1} value={options.startingSequence} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 999999999) change('startingSequence', n); }} /></label>
              <p>Example format: <strong>{sampleReference}</strong>. Each document type has its own yearly sequence. The actual next number continues after the highest allocated number; this setting never resets it. Changing the prefix does not reset numbering.</p>
              <p>Invoice, receipt and sale references retain their fixed INV, RCP and SALE labels. Existing documents keep their original design and reference.</p>
            </div>
            <div className="invoice-settings-preview"><p>Live design preview · fictional customer and vehicle · no document is issued</p><SalesDocument draft={sample} dealer={previewDealer} documentType="Sales invoice" /></div>
          </div>
          <label className="integration-field">
            Terms and conditions of sale
            <Textarea
              disabled={busy}
              rows={8}
              maxLength={20000}
              value={value.saleTerms}
              onChange={(e) =>
                setValue({ ...value, saleTerms: e.target.value })
              }
            />
          </label>
          <label className="integration-field">
            Reservation and deposit terms
            <Textarea
              disabled={busy}
              rows={6}
              maxLength={20000}
              value={value.reservationTerms}
              onChange={(e) =>
                setValue({ ...value, reservationTerms: e.target.value })
              }
            />
          </label>
          <Button disabled={busy || !changed} onClick={() => void save()}>
            {busy ? "Saving…" : "Save document settings"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => { if (!changed || window.confirm("Discard unsaved document settings and reload?")) void load(); }}>Reload saved settings</Button>
        </>
      ) : (
        <Button disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Load sales paperwork"}</Button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
