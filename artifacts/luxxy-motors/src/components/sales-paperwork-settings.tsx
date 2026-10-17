import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsTabs } from "@/components/settings-tabs";
import { FileCheck2, Palette, CreditCard, FileText } from "lucide-react";
import { defaultInvoiceSettings, invoiceTextLimits, invoiceBranding, saleWorkspaceBranding, saleWorkspaceNumber, type InvoiceSettings } from '@workspace/vehicle-meta';
import { PdfSalesDocument } from './sales-demo/sales-document';
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
  const [settingsTab, setSettingsTab] = useState("design");
  const [dealer, setDealer] = useState<DealerConfig>();
  useEffect(() => { void customFetch<DealerConfig>('/api/dealer-settings').then(setDealer).catch(() => {}); }, []);
  const [value, setValue] = useState<Paperwork>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Paperwork>();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ dealer: DealerConfig; terms: string; options: InvoiceSettings } | null>(null);
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
    if (!value || busy || tooLong) return;
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
              invoiceSettings: options,
            }),
          },
        )
      );
      setValue(result); setSaved(result);
      setMessage(
        "Document settings saved. Existing issued documents keep their original design, reference and terms.",
      );
    } catch (error) {
      setError(
        "Could not save. " + (error instanceof Error ? error.message : "Reload if these settings changed on another device."),
      );
    } finally {
      setBusy(false);
    }
  }
  const changed = Boolean(value && saved && (value.saleTerms !== saved.saleTerms || value.reservationTerms !== saved.reservationTerms || JSON.stringify(value.invoiceSettings) !== JSON.stringify(saved.invoiceSettings)));
  const originalOptions = { ...defaultInvoiceSettings, ...value?.invoiceSettings };
  const options: InvoiceSettings = { ...originalOptions, style: originalOptions.style==='premium' || originalOptions.style==='branded' ? 'branded' : 'understated' };
  const lengths = { saleTerms:value?.saleTerms??'', reservationTerms:value?.reservationTerms??'', footer:options.footer, paymentInstructions:options.paymentInstructions };
  const tooLong = (Object.keys(invoiceTextLimits) as Array<keyof typeof invoiceTextLimits>).some(k=>lengths[k].length>invoiceTextLimits[k]);
  const counter = (key: keyof typeof invoiceTextLimits) => <small className={lengths[key].length>invoiceTextLimits[key]?'invoice-wording-limit exceeded':'invoice-wording-limit'}>{lengths[key].length} / {invoiceTextLimits[key]} characters</small>;
  const change = <K extends keyof InvoiceSettings>(key: K, next: InvoiceSettings[K]) => value && setValue({ ...value, invoiceSettings: { ...options, [key]: next } });
  const sampleReference = saleWorkspaceNumber({}, 'invoice', new Date().toISOString(), options);
  const previewDealer = invoiceBranding(saleWorkspaceBranding(dealer), options) as DealerConfig;
  const sample = { ...emptyDraft(), id: 'DESIGN-SAMPLE', customer: 'Jamie Taylor', address:'12 Maple Close, London', vehicle: 'Mercedes-Benz E-Class E220d AMG Line', price: '24500', registration: 'AB20 XYZ', notes: '' };
  return (
    <section className="integration-settings invoice-settings" aria-label="Sales paperwork settings" data-settings-dirty={changed}>
      <div className="integration-heading"><div><p className="integration-eyebrow">Sales documents</p><h2>Invoices & terms</h2><p>Set your invoice design, payment details and approved wording.</p></div><FileCheck2 aria-hidden="true" /></div>
      {error && <p role="alert" className="integration-error">{error}</p>}
      {value ? (
        <>
          <SettingsTabs idPrefix="invoice-settings" label="Invoice settings" value={settingsTab} onValueChange={setSettingsTab} items={[{id:'design',label:'Design',icon:Palette},{id:'payment',label:'Payment & references',icon:CreditCard},{id:'terms',label:'Terms',icon:FileText}]} />
          <div role="tabpanel" id="invoice-settings-panel-design" aria-labelledby="invoice-settings-tab-design" hidden={settingsTab !== 'design'} className="invoice-settings-panel">
          <div className="invoice-settings-layout">
            <div className="invoice-settings-controls integration-card">
              <header><h3>Your invoice design</h3><p>Choose a style that suits your dealership.</p></header>
              <label className="integration-field">Design style<select disabled={busy} value={options.style} onChange={e => change('style', e.target.value as InvoiceSettings['style'])}><option value="understated">Design A - clean stationery</option><option value="branded">Design B - accent stationery</option></select></label>
              <p className="invoice-design-help">White stationery, fine section rules and compact amount columns. Design B uses your accent for headings and rules. The QR verification code is added when the invoice is issued.</p>
              <label><input type="checkbox" disabled={busy} checked={options.useWebsiteColour} onChange={e => change('useWebsiteColour', e.target.checked)} /> Use website colour</label>
              <label className="integration-field">Invoice colour<input type="color" disabled={busy || options.useWebsiteColour} value={options.accent} onChange={e => change('accent', e.target.value)} /></label>
              <label><input type="checkbox" disabled={busy} checked={options.showLogo} onChange={e => change('showLogo', e.target.checked)} /> Show dealership logo</label>
              <label className="integration-field">Logo size<select disabled={busy} value={options.logoSize} onChange={e => change('logoSize', e.target.value as InvoiceSettings['logoSize'])}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
              <label><input type="checkbox" disabled={busy} checked={options.inkSaving} onChange={e => change('inkSaving', e.target.checked)} /> Ink-saving design</label>
              <label className="integration-field">Thank-you / footer wording<Textarea disabled={busy} rows={2} maxLength={invoiceTextLimits.footer} aria-invalid={options.footer.length>invoiceTextLimits.footer} value={options.footer} onChange={e => change('footer', e.target.value)} /></label>{counter('footer')}
            </div>
            <div className="invoice-settings-preview"><h3>A4 design check</h3><p>Fictional customer and vehicle. Preview only updates when you ask; nothing is issued.</p><Button disabled={busy||tooLong||!dealer} onClick={()=>setPreview({dealer:previewDealer,terms:value.saleTerms,options:{...options}})}>{preview?'Update A4 preview':'Check A4 preview'}</Button>{preview ? <><PdfSalesDocument draft={sample} dealer={preview.dealer} documentType="Sales invoice" invoiceTerms={preview.terms} savedVehicle={{id:sample.vehicleId,year:2020,fuel:'Diesel',transmission:'Automatic',mileage:22000,colour:'Obsidian Black',engineSize:'2.0L',owners:1,serviceHistory:'Full'}}/>{JSON.stringify(preview.options)!==JSON.stringify(options)||preview.terms!==value.saleTerms?<p role="status">Settings have changed. Update the preview to check this version.</p>:null}</> : <div className="invoice-preview-empty">Your invoice preview will appear here.</div>}<p className="invoice-design-help">Character limits keep wording compact. Every actual invoice is also measured: excess content is refused rather than carried onto a second page or removed. Keep all confirmed payments.</p></div>
          </div>
          </div>
          <div role="tabpanel" id="invoice-settings-panel-payment" aria-labelledby="invoice-settings-tab-payment" hidden={settingsTab !== 'payment'} className="invoice-settings-panel">
            <div className="invoice-settings-detail-grid">
              <div className="invoice-settings-controls integration-card"><header><h3>Payment & references</h3><p>The details customers use to pay and identify their invoice.</p></header>
              <label className="integration-field">Payment instructions<Textarea disabled={busy} rows={3} maxLength={invoiceTextLimits.paymentInstructions} aria-invalid={options.paymentInstructions.length>invoiceTextLimits.paymentInstructions} value={options.paymentInstructions} onChange={e => change('paymentInstructions', e.target.value)} /></label>{counter('paymentInstructions')}
              <p>Leave payment instructions blank to omit them. Enter only this dealership’s verified payment details.</p>
              <label className="integration-field">Dealer reference prefix<input disabled={busy} maxLength={12} pattern="[A-Z0-9]*" value={options.referencePrefix} onChange={e => change('referencePrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
              <label className="integration-field">Starting sequence (minimum)<input disabled={busy} type="number" min={1} max={999999999} step={1} value={options.startingSequence} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 999999999) change('startingSequence', n); }} /></label>
              <p>Example format: <strong>{sampleReference}</strong>. Each document type has its own yearly sequence. The actual next number continues after the highest allocated number; this setting never resets it. Changing the prefix does not reset numbering.</p>
              <p>Invoice, receipt and sale references retain their fixed INV, RCP and SALE labels. Existing documents keep their original design and reference.</p>
              </div>
              <aside className="invoice-settings-guidance"><CreditCard aria-hidden="true" /><h3>Clear payment records</h3><p>Deposit and full invoices include every confirmed payment, with its date and amount.</p><p>Only add verified payment details for this dealership. Leave the instructions blank to omit them.</p><p>Existing issued documents keep their original reference and payment details.</p></aside>
            </div>
          </div>
          <div role="tabpanel" id="invoice-settings-panel-terms" aria-labelledby="invoice-settings-tab-terms" hidden={settingsTab !== 'terms'} className="invoice-settings-panel">
            <div className="invoice-settings-detail-grid"><div className="integration-card invoice-settings-terms"><header><h3>Approved dealership wording</h3><p>Use your approved terms. Character limits help keep invoices on one A4 sheet.</p></header>
          <label className="integration-field">
            Terms and conditions of sale
            <Textarea
              disabled={busy}
              rows={8}
              maxLength={invoiceTextLimits.saleTerms}
              aria-invalid={value.saleTerms.length>invoiceTextLimits.saleTerms}
              value={value.saleTerms}
              onChange={(e) =>
                setValue({ ...value, saleTerms: e.target.value })
              }
            />
          </label>
          {counter('saleTerms')}
          <label className="integration-field">
            Reservation and deposit terms
            <Textarea
              disabled={busy}
              rows={6}
              maxLength={invoiceTextLimits.reservationTerms}
              aria-invalid={value.reservationTerms.length>invoiceTextLimits.reservationTerms}
              value={value.reservationTerms}
              onChange={(e) =>
                setValue({ ...value, reservationTerms: e.target.value })
              }
            />
          </label>
          {counter('reservationTerms')}
            </div><aside className="invoice-settings-guidance"><FileCheck2 aria-hidden="true" /><h3>Saved with each invoice</h3><p>New documents use the wording saved here. Issued documents keep the terms agreed at the time.</p><p>Each new invoice includes a QR code to verify its reference, vehicle and issue-time amounts. Customer contact details remain private.</p></aside></div>
          </div>
          {tooLong&&<p role="alert" className="integration-error">Existing wording exceeds the A4 limits. Shorten it before saving. Nothing has been removed automatically.</p>}
          <div className="invoice-settings-save-bar"><p>{changed ? 'You have unsaved changes' : 'All document settings saved'}<small>Changes apply to future documents.</small></p><div>
          <Button disabled={busy || !changed || tooLong} onClick={() => void save()}>
            {busy ? "Saving…" : "Save document settings"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => { if (!changed || window.confirm("Discard unsaved document settings and reload?")) void load(); }}>Reload saved settings</Button>
          </div></div>
        </>
      ) : (
        <Button disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Load sales paperwork"}</Button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
