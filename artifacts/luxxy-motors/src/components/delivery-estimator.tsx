import { useEffect, useId, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { normalisePostcode, validPostcodeSyntax } from '@workspace/vehicle-meta';
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { Input } from './ui/input';
import { Button } from "./ui/button";
import { ArrowRight, ChevronDown, MapPin, Truck } from './icons';
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
  const postcodeId = useId();
  const postcodeInput = useRef<HTMLInputElement>(null);
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
    if (!validPostcodeSyntax(postcode)) {
      setSavedQuote(null);
      setBusy(false);
      setError('Enter a full UK postcode, for example SW1A 1AA.');
      postcodeInput.current?.focus();
      return;
    }
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
      className={`delivery-estimator delivery-estimator-redesigned${expanded ? ' is-expanded' : ''}`}
    >
      <summary
        hidden={expanded}
        className="delivery-estimator-toggle"
      >
        <span><Truck aria-hidden="true" />Estimate your delivery cost</span><ChevronDown aria-hidden="true" />
      </summary>
      <div className="delivery-estimator-content">
        <div className="delivery-estimator-entry">
          <div className="delivery-estimator-field">
            <label htmlFor={postcodeId}>Delivery postcode</label>
            <Input
              ref={postcodeInput}
              id={postcodeId}
              value={postcode}
              onChange={event => change(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (!busy && postcode.trim()) void calculate();
                }
              }}
              maxLength={20}
              autoComplete="postal-code"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="e.g. SW1A 1AA"
              aria-invalid={error.startsWith('Enter ') || error.startsWith('Please check') || undefined}
              aria-describedby={`${postcodeId}-help${error ? ` ${postcodeId}-error` : ''}`}
            />
          </div>
          <Button type="button" className="delivery-estimator-calculate" disabled={busy || !postcode.trim()} onClick={() => void calculate()}>
            {busy ? 'Getting estimate…' : 'Get estimate'}<ArrowRight aria-hidden="true" />
          </Button>
        </div>
        <p id={`${postcodeId}-help`} className="delivery-estimator-help">Where would you like the car delivered?</p>
        {error && (
          <p id={`${postcodeId}-error`} role="alert" className="delivery-estimator-error">
            {error}
          </p>
        )}
        {estimate && (
          <div
            role="status"
            aria-live="polite"
            className="delivery-estimator-result"
          >
            <div className="delivery-estimator-price">
              <div><span>Estimated delivery</span><strong>{pounds(estimate.totalPence)}</strong></div>
              <Truck aria-hidden="true" />
            </div>
            <div className="delivery-estimator-journey" aria-label="Delivery journey">
              <div><MapPin aria-hidden="true" /><span><small>From our showroom</small><strong>{validPostcodeSyntax(settings.address?.postcode ?? '') ? normalisePostcode(settings.address.postcode) : 'Showroom'}</strong></span></div>
              <ArrowRight className="delivery-estimator-journey-arrow" aria-hidden="true" />
              <div><MapPin aria-hidden="true" /><span><small>To your postcode</small><strong>{estimate.postcode}</strong></span></div>
              <p>{estimate.roadMiles.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} road miles <span>one way</span></p>
            </div>
            {total && (
              <dl className="delivery-estimate-total">
                <div>
                  <dt>Car price</dt>
                  <dd>{pounds(total.vehiclePence)}</dd>
                </div>
                <div>
                  <dt>Delivery</dt>
                  <dd>{pounds(estimate.totalPence)}</dd>
                </div>
                <div className="delivery-estimate-total-sum">
                  <dt>Estimated total</dt>
                  <dd>{pounds(total.totalPence)}</dd>
                </div>
              </dl>
            )}
            <details className="delivery-estimator-breakdown">
              <summary>How the delivery price is worked out<ChevronDown aria-hidden="true" /></summary>
              <dl>
              <div>
                <dt>Base charge</dt>
                <dd>{pounds(estimate.basePricePence)}</dd>
              </div>
              <div>
                <dt>
                  {estimate.roadMiles.toLocaleString("en-GB")} miles ×{" "}
                  {pounds(estimate.pricePerMilePence)}
                </dt>
                <dd>{pounds(estimate.mileageChargePence)}</dd>
              </div>
              </dl>
              <p>Calculated using the driving route between the two postcode locations.</p>
            </details>
            {!total && priceQualification && <p className="delivery-estimator-qualification">{priceQualification}</p>}
            <div className="delivery-estimator-next">
              <strong>Confirm delivery with our showroom</strong>
              <p>We’ll confirm the final price and a suitable day. Nothing is booked or charged.</p>
            {onEnquire && (
              <Button
                type="button"
                className="delivery-estimate-enquiry"
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
                Include estimate in my enquiry<ArrowRight aria-hidden="true" />
              </Button>
            )}
            </div>
          </div>
        )}
        <p className="delivery-estimator-attribution">
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
