import { useEffect, useRef, useState } from "react";
import { customFetch, HttpApiError } from "@workspace/api-client-react";
import type { SaleWorkspaceRecord } from "@workspace/vehicle-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Truck } from "@/components/icons";
import { requestUuid } from "@/lib/request-uuid";
export function SaleDeliveryCharge({
  sale,
  onSaved,
  onBusyChange,
}: {
  sale: SaleWorkspaceRecord;
  onSaved: (sale: SaleWorkspaceRecord) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [amount, setAmount] = useState(sale.draft.deliveryCharge || "0"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const retry = useRef<{ key: string; id: string } | undefined>(undefined);
  const lock = useRef(false), generation = useRef(0);
  const latest = useRef({ sale, onSaved });
  latest.current = { sale, onSaved };
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    lock.current = false;
    setBusy(false);
    return () => { generation.current++; };
  }, [sale.id]);
  useEffect(() => {
    setAmount(sale.draft.deliveryCharge || "0");
    setError("");
    retry.current = undefined;
  }, [sale.id, sale.revision]);
  async function save() {
    if (lock.current) return;
    lock.current = true;
    const token = generation.current, request = { id: sale.id, revision: sale.revision };
    setBusy(true);
    setError("");
    const key = JSON.stringify([sale.id, sale.revision, amount]);
    if (retry.current?.key !== key) retry.current = { key, id: requestUuid() };
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(
        `/api/sale-operations/${sale.id}/delivery-charge`,
        {
          method: "POST",
          body: JSON.stringify({
            amount,
            requestId: retry.current.id,
            expectedRevision: sale.revision,
          }),
        },
      );
      if (token !== generation.current || latest.current.sale.id !== request.id) return;
      if (latest.current.sale.revision !== request.revision) {
        setError("The delivery charge was saved. Reload this sale before making another change; your newer details have been kept.");
        return;
      }
      latest.current.onSaved(result.sale);
    } catch (e) {
      if (token !== generation.current || latest.current.sale.id !== request.id) return;
      setError(
        e instanceof HttpApiError &&
          e.data &&
          typeof e.data === "object" &&
          "error" in e.data
          ? String(e.data.error)
          : "The delivery charge could not be saved. Try again.",
      );
    } finally {
      if (token === generation.current && latest.current.sale.id === request.id) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="sale-desk-sheet" aria-label="Delivery charge">
      <h3>
        <Truck size={18} aria-hidden="true" /> Delivery charge
      </h3>
      <p>
        Included in the deal total and customer invoice. Enter 0 for free
        delivery.
      </p>
      {sale.documents.some((d) => d.type === "invoice") && (
        <p>
          Any increase will create a separate delivery invoice. The issued
          vehicle invoice keeps its original figures.
        </p>
      )}
      <label>
        Delivery charge (£)
        <Input
          value={amount}
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Button
        variant="outline"
        disabled={busy || amount === (sale.draft.deliveryCharge || "0")}
        onClick={() => void save()}
      >
        {busy ? "Saving charge…" : "Save delivery charge"}
      </Button>
    </section>
  );
}
