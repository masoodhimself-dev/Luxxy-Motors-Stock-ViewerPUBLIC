import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { VehicleBadgeIcon } from "./vehicle-badge-icon";
import { Truck } from "./icons";

type VehicleCheckActions = {
  motHistory: MotHistory | null;
  requestMotHistory: () => void;
  motBadge: ReactNode;
  motAction: ReactNode;
  deliveryAction: ReactNode;
};

export function VehicleQuickChecks({ vehicleId, children }: {
  vehicleId: string;
  children: (actions: VehicleCheckActions) => ReactNode;
}) {
  const { settings } = useDealerSettings();
  const [panel, setPanel] = useState<"mot" | "delivery" | null>(null);
  const [history, setHistory] = useState<MotHistory | null>(null);
  const [estimate, setEstimate] = useState<DeliveryEstimate | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const answerLookup = useRef<AbortController | null>(null);
  const requestMotHistory = useCallback(() => {
    // The customer explicitly opened car answers. Load once, without polling.
    if (answerLookup.current) return;
    const controller = new AbortController(); answerLookup.current = controller;
    customFetch<{status: string; history?: MotHistory}>(`/api/vehicles/${encodeURIComponent(vehicleId)}/mot-history`, {signal:controller.signal})
      .then(reply => { if (!controller.signal.aborted && reply.status === 'available' && reply.history) setHistory(reply.history); })
      .catch(() => {});
  }, [vehicleId]);
  useEffect(() => () => { answerLookup.current?.abort(); answerLookup.current = null; }, [vehicleId]);
  function open(next: "mot" | "delivery", trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    setPanel(next);
  }
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
          setHistory(current => current && Date.parse(current.checkedAt) >= Date.parse(reply.history!.checkedAt) ? current : reply.history!);
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
  const motBadge = firstDue || badge ? <>
      {firstDue && (
        <button
          type="button"
          className="vehicle-long-mot"
          onClick={(event) => open("mot", event.currentTarget)}
          title={`First MOT due ${firstDue}`}
        >
          <VehicleBadgeIcon kind="mot" />
          <span>MOT not required until{" "}
          {new Date(firstDue + "T12:00:00Z").toLocaleDateString("en-GB", {
            month: "2-digit",
            year: "numeric",
            timeZone: "Europe/London",
          })}</span>
        </button>
      )}
      {badge && (
        <button
          type="button"
          className="vehicle-long-mot"
          onClick={(event) => open("mot", event.currentTarget)}
        >
          <VehicleBadgeIcon kind="mot" />
          <span>Long MOT · {badge.months} months left</span>
        </button>
      )}
    </> : null;
  const motAction = (
    <Button type="button" variant="ghost"
      className="vehicle-context-action" onClick={(event) => open("mot", event.currentTarget)}>
      <VehicleFactIcon label="MOT" /><span>MOT history</span>
    </Button>
  );
  const deliveryAction = deliveryEnabled ? (
    <Button type="button" variant="ghost"
      className="vehicle-context-action" onClick={(event) => open("delivery", event.currentTarget)}>
      <Truck className="h-4 w-4" aria-hidden="true" />
      <span>{estimate ? `Delivery · est. £${(estimate.totalPence / 100).toFixed(2)}` : "Delivery estimate"}</span>
    </Button>
  ) : null;
  return <>
      {children({ motBadge, motAction, deliveryAction, motHistory: history, requestMotHistory })}
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
            if (lastTrigger.current?.isConnected)
              lastTrigger.current.focus({ preventScroll: true });
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
    </>;
}
