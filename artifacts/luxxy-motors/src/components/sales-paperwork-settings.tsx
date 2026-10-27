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
};
export function SalesPaperworkSettings() {
  const [value, setValue] = useState<Paperwork | null>(null),
    [saved, setSaved] = useState<Paperwork | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const options = { ...defaultInvoiceSettings, ...value?.invoiceSettings };
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
        "/api/dealer-integrations/sales-paperwork",
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
      );
      setValue(result);
      setSaved(result);
      setNotice(
        "Document settings saved. Existing invoices, payment records and numbering stay unchanged.",
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
              maxLength={invoiceTextLimits.saleTerms}
              value={value.saleTerms}
              onChange={(e) =>
                setValue({ ...value, saleTerms: e.target.value })
              }
            />
          </label>
          <label className="integration-field">
            Deposit and reservation terms
            <Textarea
              rows={5}
              maxLength={invoiceTextLimits.reservationTerms}
              value={value.reservationTerms}
              onChange={(e) =>
                setValue({ ...value, reservationTerms: e.target.value })
              }
            />
          </label>
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
