import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { PostcodeField } from "./postcode-field";
import { Button } from "./ui/button";
import {
  deliveryQuoteContext,
  usableDeliveryEstimate,
  deliveryVehicleTotal,
  deliveryPriceQualification,
  deliveryMoney as pounds,
  deliveryEnquiryMessage,
  type DeliveryEstimate,
} from "@/lib/delivery-estimate";
export type { DeliveryEstimate } from "@/lib/delivery-estimate";
import "./delivery-estimator.css";
export function DeliveryEstimator({
  expanded = false,
  onEstimate,
  initialEstimate = null,
  vehiclePrice,
  currency,
  priceType,
  onEnquire,
}: {
  expanded?: boolean;
  onEstimate?: (estimate: DeliveryEstimate | null) => void;
  initialEstimate?: DeliveryEstimate | null;
  vehiclePrice?: number | null;
  currency?: string | null;
  priceType?: string | null;
  onEnquire?: (message: string) => void;
} = {}) {
  const { settings } = useDealerSettings(),
    pricing = settings.deliveryPricing;
  const context = deliveryQuoteContext(settings);
  const enabled = Boolean(settings.delivery?.enabled && pricing?.enabled);
  const [postcode, setPostcode] = useState(initialEstimate?.postcode ?? ""),
    [busy, setBusy] = useState(false),
    [savedQuote, setSavedQuote] = useState<{
      context: string;
      value: DeliveryEstimate;
    } | null>(initialEstimate ? { context, value: initialEstimate } : null),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const current = useRef({
    context,
    postcode,
    vehiclePrice,
    currency,
    priceType,
    onEnquire,
  });
  current.current = { context, postcode, vehiclePrice, currency, priceType, onEnquire };
  const estimate =
    enabled &&
    savedQuote?.context === context &&
    usableDeliveryEstimate(savedQuote.value, postcode, pricing)
      ? savedQuote.value
      : null;
  const total = estimate
    ? deliveryVehicleTotal(vehiclePrice, currency, estimate.totalPence, priceType)
    : null;
  const priceQualification = deliveryPriceQualification(priceType);
  useEffect(() => {
    onEstimate?.(estimate);
  }, [estimate, onEstimate]);
  useEffect(() => {
    request.current?.abort();
    setSavedQuote((saved) => (saved?.context === context ? saved : null));
    setError("");
    setBusy(false);
  }, [context]);
  useEffect(() => () => request.current?.abort(), []);
  if (!enabled) return null;
  function change(value: string) {
    request.current?.abort();
    setBusy(false);
    setPostcode(value);
    setSavedQuote(null);
    setError("");
  }
  async function calculate() {
    request.current?.abort();
    const controller = new AbortController();
    const requestedContext = context;
    const requestedPostcode = postcode;
    request.current = controller;
    setBusy(true);
    setError("");
    setSavedQuote(null);
    const isCurrent = () =>
      !controller.signal.aborted &&
      request.current === controller &&
      current.current.context === requestedContext &&
      current.current.postcode === requestedPostcode;
    try {
      const result = await customFetch<DeliveryEstimate>(
        `/api/postcodes/delivery-estimate?postcode=${encodeURIComponent(postcode.trim())}`,
        { signal: controller.signal },
      );
      if (!isCurrent()) return;
      if (!usableDeliveryEstimate(result, requestedPostcode, pricing))
        throw Error("No road estimate");
      setPostcode(result.postcode);
      setSavedQuote({ context: requestedContext, value: result });
    } catch (cause) {
      if (isCurrent()) {
        const code = (cause as { data?: { code?: string } })?.data?.code;
        setError(
          code === "invalid" || code === "not_found"
            ? "Please check your postcode and try again."
            : "We couldn’t calculate a road delivery estimate. Please contact us for a quote.",
        );
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  return (
    <details
      open={expanded || undefined}
      aria-label="Delivery cost estimate"
      className={
        expanded
          ? "delivery-estimator min-w-0 text-card-foreground"
          : "delivery-estimator mt-4 rounded-md border border-border bg-card p-4 text-card-foreground"
      }
    >
      <summary
        hidden={expanded}
        className="min-h-11 cursor-pointer py-2 font-semibold"
      >
        Estimate your delivery cost
      </summary>
      <div>
        <p className="mb-3 mt-1 text-xs leading-5 text-muted-foreground">
          Base charge plus the one-way driving distance to your postcode.
        </p>
        <PostcodeField
          label="Delivery postcode"
          value={postcode}
          onChange={change}
          helpText="Enter the postcode where you would like the car delivered."
        />
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          disabled={busy || !postcode.trim()}
          onClick={() => void calculate()}
        >
          {busy ? "Calculating road miles…" : "Calculate delivery"}
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {estimate && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 border-t border-border pt-3"
          >
            <p className="text-xs text-muted-foreground">
              Delivery to {estimate.postcode} ·{" "}
              {estimate.roadMiles.toLocaleString("en-GB", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}{" "}
              road miles
            </p>
            {!total && (
              <strong className="mt-1 block font-display text-2xl font-semibold">
                {pounds(estimate.totalPence)}{" "}
                <span className="font-sans text-xs font-normal text-muted-foreground">
                  estimated delivery
                </span>
              </strong>
            )}
            {total && (
              <dl className="delivery-estimate-total">
                <div>
                  <dt>Car price</dt>
                  <dd>{pounds(total.vehiclePence)}</dd>
                </div>
                <div>
                  <dt>Estimated delivery</dt>
                  <dd>{pounds(estimate.totalPence)}</dd>
                </div>
                <div className="delivery-estimate-total-sum">
                  <dt>Estimated total</dt>
                  <dd>{pounds(total.totalPence)}</dd>
                </div>
              </dl>
            )}
            <dl className="mt-3 space-y-1 text-xs">
              <div className="flex justify-between gap-3">
                <dt>Base charge</dt>
                <dd>{pounds(estimate.basePricePence)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>
                  {estimate.roadMiles.toLocaleString("en-GB")} miles ×{" "}
                  {pounds(estimate.pricePerMilePence)}
                </dt>
                <dd>{pounds(estimate.mileageChargePence)}</dd>
              </div>
            </dl>
            {!total && priceQualification && <p className="mt-3 text-sm leading-5 text-muted-foreground">{priceQualification}</p>}
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Estimated from postcode locations using a driving route. The
              dealership will confirm the final price and delivery availability.
              Nothing is booked or charged.
            </p>
            {onEnquire && (
              <Button
                type="button"
                className="delivery-estimate-enquiry mt-3 w-full"
                onClick={() => {
                  if (
                    savedQuote?.context !== current.current.context ||
                    !usableDeliveryEstimate(
                      savedQuote.value,
                      current.current.postcode,
                      pricing,
                    )
                  )
                    return;
                  current.current.onEnquire?.(
                    deliveryEnquiryMessage(
                      savedQuote.value,
                      deliveryVehicleTotal(
                        current.current.vehiclePrice,
                        current.current.currency,
                        savedQuote.value.totalPence,
                        current.current.priceType,
                      ),
                      current.current.priceType,
                    ),
                  );
                }}
              >
                Include estimate in my enquiry
              </Button>
            )}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
          Road routing by{" "}
          <a
            href="https://openrouteservice.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            openrouteservice
          </a>{" "}
          · ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            OpenStreetMap contributors
          </a>
        </p>
      </div>
    </details>
  );
}
