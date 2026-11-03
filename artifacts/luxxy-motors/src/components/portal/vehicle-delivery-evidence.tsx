import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Truck, ChevronDown } from "@/components/icons";
import {
  declarationError,
  declarationRequest,
} from "@/lib/test-drive-declarations";
import { SaleDeliveryEvidence } from "./sale-delivery-evidence";
import "./sale-delivery-evidence.css";

type VehicleDeliverySales = {
  sales: Array<{
    saleId: string;
    reference: string;
    revision: number;
    evidenceCount: number;
  }>;
};
function VehicleEvidenceSale({
  sale,
}: {
  sale: VehicleDeliverySales["sales"][number];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {sale.reference} · {sale.evidenceCount}{" "}
        {sale.evidenceCount === 1 ? "delivery file" : "delivery files"}
      </summary>
      {open && (
        <SaleDeliveryEvidence
          saleId={sale.saleId}
          revision={sale.revision}
          readOnly
        />
      )}
    </details>
  );
}
/** Evidence remains accessible after a sale is returned, or the car is resold. */
export function VehicleDeliveryEvidence({ vehicleId }: { vehicleId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["vehicle-delivery-evidence", vehicleId],
    queryFn: () =>
      declarationRequest<VehicleDeliverySales>(
        `/api/staff/vehicles/${vehicleId}/delivery-evidence`,
      ),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  return (
    <section
      className="vehicle-delivery-evidence"
      aria-label="Vehicle delivery evidence"
    >
      <button
        type="button"
        className="vehicle-evidence-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Truck aria-hidden="true" />
        <span>Delivery evidence</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="vehicle-evidence-body">
          {query.isPending ? (
            <p role="status">Loading delivery evidence…</p>
          ) : query.isError ? (
            <p role="alert">{declarationError(query.error)}</p>
          ) : !query.data?.sales?.length ? (
            <p>
              No delivery reports or photos have been saved for this vehicle.
            </p>
          ) : (
            query.data.sales.map((sale) => (
              <VehicleEvidenceSale key={sale.saleId} sale={sale} />
            ))
          )}
        </div>
      )}
    </section>
  );
}
