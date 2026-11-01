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
import "./vehicle-checks.css";
import { useVehicleDialogTheme } from "./vehicle-dialog-vehicle";
import { deliveryQuoteContext } from "@/lib/delivery-estimate";

type VehicleCheckActions = {
  motHistory: MotHistory | null;
  requestMotHistory: () => void;
  motBadge: ReactNode;
  motAction: ReactNode;
  deliveryAction: ReactNode;
};

export function VehicleQuickChecks({
  vehicleId,
  vehiclePrice,
  currency,
  priceType,
  onEnquire,
  children,
}: {
  vehicleId: string;
  vehiclePrice?: number | null;
  currency?: string | null;
  priceType?: string | null;
  onEnquire?: (message: string) => void;
  children: (actions: VehicleCheckActions) => ReactNode;
}) {
  const { settings } = useDealerSettings();
  const dialogTheme = useVehicleDialogTheme();
  const [panel, setPanel] = useState<"mot" | "delivery" | null>(null);
  // Radix keeps the dialog mounted during its exit animation. Keep the visible
  // content stable until it unmounts, rather than switching to the other tool.
  const lastPanel = useRef<"mot" | "delivery">("mot");
  const shownPanel = panel ?? lastPanel.current;
  const [history, setHistory] = useState<MotHistory | null>(null);
  const quoteContext = JSON.stringify([
    vehicleId,
    deliveryQuoteContext(settings),
  ]);
  const [savedEstimate, setSavedEstimate] = useState<{
    context: string;
    value: DeliveryEstimate;
  } | null>(null);
  const estimate =
    savedEstimate?.context === quoteContext ? savedEstimate.value : null;
  const acceptEstimate = useCallback(
    (value: DeliveryEstimate | null) => {
      setSavedEstimate(value ? { context: quoteContext, value } : null);
    },
    [quoteContext],
  );
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const handoffScope = JSON.stringify([quoteContext, vehiclePrice, currency, priceType]);
  const currentEnquiry = useRef({ scope: handoffScope, onEnquire });
  currentEnquiry.current = { scope: handoffScope, onEnquire };
  const pendingEnquiry = useRef<{scope: string; message: string} | null>(null);
  const handoffFrame = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    cancelAnimationFrame(handoffFrame.current ?? 0);
    pendingEnquiry.current = null;
  }, [vehicleId]);
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
    lastPanel.current = next;
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
    setSavedEstimate((saved) =>
      saved?.context === quoteContext ? saved : null,
    );
  }, [quoteContext]);
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
          className="vehicle-check-dialog max-w-xl"
          style={dialogTheme}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const pending = pendingEnquiry.current;
            pendingEnquiry.current = null;
            if (pending && pending.scope === currentEnquiry.current.scope && currentEnquiry.current.onEnquire) {
              handoffFrame.current = requestAnimationFrame(() => {
                if (pending.scope === currentEnquiry.current.scope) currentEnquiry.current.onEnquire?.(pending.message);
              });
              return;
            }
            if (lastTrigger.current?.isConnected)
              lastTrigger.current.focus({ preventScroll: true });
          }}
        >
          <DialogHeader className="vehicle-check-header text-left">
            <DialogTitle className="pr-12 text-xl">
              {shownPanel === "delivery" ? "Delivery estimate" : "MOT history"}
            </DialogTitle>
            <DialogDescription>
              {shownPanel === "delivery"
                ? "Enter a postcode for a road-mile delivery estimate."
                : "Recorded test results, mileage and advisory notices."}
            </DialogDescription>
          </DialogHeader>
          <div className="vehicle-check-body">
            {shownPanel === "mot" && (
              <MotHistoryPanel
                vehicleId={vehicleId}
                autoLoad
                onHistory={setHistory}
              />
            )}
            {/* Keep the quote and postcode when closing or switching panels. */}
            <div hidden={shownPanel !== "delivery"}>
              <DeliveryEstimator
                key={vehicleId}
                expanded
                initialEstimate={estimate}
                onEstimate={acceptEstimate}
                vehiclePrice={vehiclePrice}
                currency={currency}
                priceType={priceType}
                onEnquire={
                  onEnquire
                    ? (message) => {
                        pendingEnquiry.current = {scope: handoffScope, message};
                        setPanel(null);
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>;
}
