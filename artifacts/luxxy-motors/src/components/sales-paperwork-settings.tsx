import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  defaultInvoiceSettings,
  invoiceTextLimits,
  type InvoiceSettings,
} from "@workspace/vehicle-meta";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import "./integration-settings.css";
type Paperwork = {
  revision: number;
  saleTerms: string;
  reservationTerms: string;
  invoiceSettings?: InvoiceSettings;
  correctionSettings?: { handling: "accountant"; instructions: string };
};
export function SalesPaperworkSettings({testSessionId}:{testSessionId?:string} = {}) {
  const endpoint = testSessionId ? `/api/sales-test/sessions/${encodeURIComponent(testSessionId)}/paperwork` : '/api/dealer-integrations/sales-paperwork';
  const [value, setValue] = useState<Paperwork | null>(null),
    [saved, setSaved] = useState<Paperwork | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const options = { ...defaultInvoiceSettings, ...value?.invoiceSettings };
  const correctionSettings = value?.correctionSettings ?? { handling: "accountant" as const, instructions: "" };
  const changed = Boolean(
    value && saved && JSON.stringify(value) !== JSON.stringify(saved),
  );
  const tooLong = Boolean(
    value &&
    (value.saleTerms.length > invoiceTextLimits.saleTerms ||
      value.reservationTerms.length > invoiceTextLimits.reservationTerms ||
      options.paymentInstructions.length >
        invoiceTextLimits.paymentInstructions),
  );
  async function load() {
    setBusy(true);
    setError("");
    try {
      const data = await customFetch<Paperwork>(
        endpoint,
      );
      setValue(data);
      setSaved(data);
    } catch {
      setError("Sales paperwork could not be loaded. Try again.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!changed) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);
  async function save() {
    if (!value || busy || tooLong) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await customFetch<Paperwork>(
        endpoint,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: value.revision,
            saleTerms: value.saleTerms,
            reservationTerms: value.reservationTerms,
            invoiceSettings: options,
            correctionSettings,
          }),
        },
      );
      setValue(result);
      setSaved(result);
      setNotice(
        testSessionId ? "Document settings saved in this test. Live records are unchanged." : "Document settings saved. Existing invoices, payment records and numbering stay unchanged.",
      );
    } catch {
      setError(
        "Could not save. Your wording is kept. Reload if another owner changed these settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="integration-settings"
      aria-label="Sales paperwork settings"
      data-settings-dirty={changed}
    >
      <header className="integration-heading">
        <div>
          <h3>Invoices and terms</h3>
          <p>
            Approved wording for new documents. Existing issued documents keep
            their saved terms, amounts and references.
          </p>
          <p>
            These fields can hold short invoice summaries. They may not contain
            the dealership’s complete terms: have the full terms reviewed and
            provide them to the customer before they commit to the sale.
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className="integration-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!value ? (
        <Button disabled={busy} onClick={() => void load()}>
          {busy ? "Loading paperwork…" : "Try again"}
        </Button>
      ) : (
        <fieldset disabled={busy} className="space-y-5">
          <label className="integration-field">
            Terms and conditions of sale
            <Textarea
              rows={8}
              aria-describedby="sale-terms-help"
              maxLength={invoiceTextLimits.saleTerms}
              value={value.saleTerms}
              onChange={(e) =>
                setValue({ ...value, saleTerms: e.target.value })
              }
            />
          </label>
          <p id="sale-terms-help" className="text-sm text-muted-foreground">
            Use the dealership’s approved sale wording. Check that any longer
            terms are given to the customer separately.
          </p>
          <label className="integration-field">
            Deposit and reservation terms
            <Textarea
              rows={5}
              aria-describedby="deposit-terms-help"
              maxLength={invoiceTextLimits.reservationTerms}
              value={value.reservationTerms}
              onChange={(e) =>
                setValue({ ...value, reservationTerms: e.target.value })
              }
            />
          </label>
          <p id="deposit-terms-help" className="text-sm text-muted-foreground">
            Explain the agreed deposit and refund policy. Only promise what the
            dealership has approved.
          </p>
          <label className="integration-field">
            Payment instructions
            <Textarea
              rows={3}
              maxLength={invoiceTextLimits.paymentInstructions}
              value={options.paymentInstructions}
              onChange={(e) =>
                setValue({
                  ...value,
                  invoiceSettings: {
                    ...options,
                    paymentInstructions: e.target.value,
                  },
                })
              }
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Enter only verified dealership payment details. Leave instructions
            blank to omit them. Documents use your dealership brand.
          </p>
          <div>
            <h4 className="font-semibold">Corrections after an invoice is issued</h4>
            <p className="text-sm text-muted-foreground">
              Your accountant handles correction paperwork. The original invoice and payment history remain intact. Creating correction documents in DealerOS is not available yet; it does not issue credit notes or change a completed sale price.
            </p>
          </div>
          <label className="integration-field">
            Instructions for staff (optional)
            <Textarea
              rows={3}
              maxLength={500}
              value={correctionSettings.instructions}
              onChange={(e) => setValue({
                ...value,
                correctionSettings: { handling: "accountant", instructions: e.target.value },
              })}
              aria-describedby="correction-instructions-help"
            />
          </label>
          <p id="correction-instructions-help" className="text-sm text-muted-foreground">
            For example: “Ask the manager to contact our accountant.” Shown to staff only, not on customer invoices.
          </p>
          {tooLong && (
            <p role="alert" className="integration-error">
              Existing wording exceeds the limits. Shorten it before saving.
              Nothing has been removed automatically.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button disabled={!changed || tooLong} onClick={() => void save()}>
              Save document settings
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (
                  !changed ||
                  window.confirm("Discard unsaved document wording?")
                )
                  void load();
              }}
            >
              Reload saved settings
            </Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
