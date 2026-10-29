import { useEffect, useRef, useState } from "react";
import type { MotHistory } from "@workspace/vehicle-meta";
import { customFetch } from "@workspace/api-client-react";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { longMot, firstMotDue } from "@/lib/long-mot";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { MotHistoryPanel } from "./mot-history";
import { DeliveryEstimator, type DeliveryEstimate } from "./delivery-estimator";
import { VehicleFactIcon } from "./vehicle-fact-icon";
import { Truck } from "./icons";

export function VehicleQuickChecks({ vehicleId }: { vehicleId: string }) {
  const { settings } = useDealerSettings();
  const [panel, setPanel] = useState<"mot" | "delivery" | null>(null);
  const [history, setHistory] = useState<MotHistory | null>(null);
  const [estimate, setEstimate] = useState<DeliveryEstimate | null>(null);
  const lastPanel = useRef<"mot" | "delivery">("mot");
  function open(next: "mot" | "delivery") {
    lastPanel.current = next;
    setPanel(next);
  }
  const motButton = useRef<HTMLButtonElement>(null),
    deliveryButton = useRef<HTMLButtonElement>(null);
  const deliveryEnabled = Boolean(
    settings.delivery?.enabled && settings.deliveryPricing?.enabled,
  );
  useEffect(() => {
    const controller = new AbortController();
    // Cache-only: never trigger a DVSA lookup, poll, or check every stock card.
    customFetch<{ status: string; history?: MotHistory }>(
      `/api/vehicles/${encodeURIComponent(vehicleId)}/mot-history?cacheOnly=true`,
      { signal: controller.signal },
    )
      .then((reply) => {
        if (
          !controller.signal.aborted &&
          reply.status === "available" &&
          reply.history
        )
          setHistory(reply.history);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [vehicleId]);
  useEffect(() => {
    if (!deliveryEnabled && panel === "delivery") setPanel(null);
  }, [deliveryEnabled, panel]);
  useEffect(() => {
    setEstimate(null);
  }, [
    deliveryEnabled,
    settings.deliveryPricing?.basePrice,
    settings.deliveryPricing?.pricePerMile,
    settings.address?.postcode,
  ]);
  const badge = longMot(history),
    firstDue = firstMotDue(history);
  return (
    <section
      className="vehicle-quick-checks"
      aria-label="Useful vehicle checks"
    >
      {firstDue && (
        <button
          type="button"
          className="vehicle-long-mot"
          onClick={() => open("mot")}
        >
          First MOT due ·{" "}
          {new Date(firstDue + "T12:00:00Z").toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "Europe/London",
          })}
        </button>
      )}
      {badge && (
        <button
          type="button"
          className="vehicle-long-mot"
          onClick={() => open("mot")}
        >
          Long MOT · {badge.months} months left
        </button>
      )}
      <div className="vehicle-quick-check-buttons">
        <Button
          ref={motButton}
          type="button"
          variant="outline"
          onClick={() => open("mot")}
        >
          <VehicleFactIcon label="MOT" />
          <span>MOT history</span>
        </Button>
        {deliveryEnabled && (
          <Button
            ref={deliveryButton}
            type="button"
            variant="outline"
            onClick={() => open("delivery")}
          >
            <Truck className="h-4 w-4" aria-hidden="true" />
            <span>
              {estimate
                ? `Delivery · est. £${(estimate.totalPence / 100).toFixed(2)}`
                : "Delivery estimate"}
            </span>
          </Button>
        )}
      </div>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <DialogContent
          className="max-w-xl max-h-[85dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (lastPanel.current === "delivery"
              ? deliveryButton
              : motButton
            ).current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="pr-12 text-xl">
              {panel === "delivery" ? "Delivery estimate" : "MOT history"}
            </DialogTitle>
            <DialogDescription>
              {panel === "delivery"
                ? "Enter a postcode for a road-mile delivery estimate."
                : "Recorded test results, mileage and advisory notices."}
            </DialogDescription>
          </DialogHeader>
          {panel === "mot" && (
            <MotHistoryPanel
              vehicleId={vehicleId}
              autoLoad
              onHistory={setHistory}
            />
          )}
          {/* Keep the quote and postcode when closing or switching panels. */}
          <div hidden={panel !== "delivery"}>
            <DeliveryEstimator
              expanded
              initialEstimate={estimate}
              onEstimate={setEstimate}
            />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
