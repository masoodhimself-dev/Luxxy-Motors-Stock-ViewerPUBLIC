import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
type Paperwork = {
  revision: number;
  saleTerms: string;
  reservationTerms: string;
};
export function SalesPaperworkSettings() {
  const [value, setValue] = useState<Paperwork>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      setValue(
        await customFetch<Paperwork>(
          "/api/dealer-integrations/sales-paperwork",
        ),
      );
      setMessage("");
    } catch {
      setMessage("Sales paperwork could not be loaded.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    if (!value) return;
    setBusy(true);
    try {
      setValue(
        await customFetch<Paperwork>(
          "/api/dealer-integrations/sales-paperwork",
          {
            method: "PUT",
            body: JSON.stringify({
              expectedRevision: value.revision,
              saleTerms: value.saleTerms,
              reservationTerms: value.reservationTerms,
            }),
          },
        ),
      );
      setMessage(
        "Approved wording saved. Existing issued documents keep their original terms.",
      );
    } catch {
      setMessage(
        "Could not save. Reload if these settings changed on another device.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="integration-card" aria-label="Sales paperwork settings">
      <h3>Sales paperwork</h3>
      <p>
        Paste your approved dealership wording. Taking a deposit and completing
        a sale save a dated copy with the customer’s document pack.
      </p>
      {value ? (
        <>
          <label className="integration-field">
            Terms and conditions of sale
            <Textarea
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
              rows={6}
              maxLength={20000}
              value={value.reservationTerms}
              onChange={(e) =>
                setValue({ ...value, reservationTerms: e.target.value })
              }
            />
          </label>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save sales paperwork"}
          </Button>
        </>
      ) : (
        <Button onClick={() => void load()}>Load sales paperwork</Button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
