import { useId, useState } from "react";
import type { Enquiry } from "@workspace/api-client-react";
import type { MotHistory } from "@workspace/vehicle-meta";
import { isUKNumberPlate } from "@workspace/vehicle-meta";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import type { Car } from "@/lib/stock-context";
import { vehicleRegistration } from "@/lib/utils";
import { firstMotDue } from "@/lib/long-mot";
import { MotHistoryPanel, PartExchangeMotCheck } from "../mot-history";
import { MotMileageEstimate } from "../mot-mileage-estimate";
import {
  DeliveryEstimator,
  type DeliveryEstimate,
} from "../delivery-estimator";
import { Button } from "../ui/button";
import "./enquiry-checks.css";

export type EnquiryChecksProps = {
  entry: Enquiry;
  car?: Car | null;
  /** The existing sales.manage permission, not an additional access rule. */
  canManage: boolean;
  /** Insert into an editable draft only. The caller must never send this text automatically. */
  onInsertText?: (text: string) => void;
};

const day = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
const pounds = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    pence / 100,
  );

/** A factual draft summary. A newer failure must not be replaced by an older pass. */
export function enquiryMotSummary(history: MotHistory) {
  const name = [history.make, history.model].filter(Boolean).join(" ");
  const vehicle = `${name ? `${name} · ` : ""}${history.registration}`;
  const latest = [...history.tests].sort(
    (a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate),
  )[0];
  const firstDue = firstMotDue(history);
  let summary = latest
    ? `${vehicle}: latest recorded MOT ${latest.result === "PASSED" ? "passed" : "failed"} on ${day(latest.completedDate)}.${latest.result === "PASSED" && latest.expiryDate ? ` Recorded expiry: ${day(latest.expiryDate)}.` : ""}`
    : firstDue
      ? `${vehicle}: first MOT due ${day(firstDue)}, according to the recorded first-MOT due date.`
      : `${vehicle}: no MOT tests were returned. This does not confirm exemption or that an MOT is not due.`;
  if (history.recall === "Yes")
    summary +=
      " An outstanding safety recall is recorded; please confirm its current status with the showroom.";
  return `${summary} MOT history checked ${day(history.checkedAt)}. Recorded results describe the car at the time of the test.`;
}

function ChecksContent({
  entry,
  car,
  onInsertText,
}: Omit<EnquiryChecksProps, "canManage">) {
  const { settings } = useDealerSettings();
  const [active, setActive] = useState<"mot" | "exchange" | "delivery" | null>(
    null,
  );
  const [history, setHistory] = useState<MotHistory | null>(null);
  const [quote, setQuote] = useState<DeliveryEstimate | null>(null);
  const [registration, setRegistration] = useState(
    entry.partExchangeRegistration || "",
  );
  const [checkedRegistration, setCheckedRegistration] = useState("");
  const [estimateRequest, setEstimateRequest] = useState(0);
  const [estimatedMileage, setEstimatedMileage] = useState("");
  const id = useId();
  const linkedCar = car?.id === entry.vehicleId ? car : null;
  const stockVehicleId = linkedCar?.id ?? entry.vehicleId;
  const stockRegistration = linkedCar
    ? vehicleRegistration(linkedCar)
    : entry.vehicleRegistration;
  const validExchangeRegistration = isUKNumberPlate(
    registration.toUpperCase().replace(/[\s-]/g, ""),
  );
  const deliveryEnabled = Boolean(
    settings.delivery?.enabled && settings.deliveryPricing?.enabled,
  );
  const partExchangeEnabled = Boolean(
    settings.partExchange?.enabled || entry.partExchangeRegistration,
  );
  const insert = (text: string) => onInsertText?.(text);
  const open = (value: typeof active) => {
    if (active !== value && value === "mot") setHistory(null);
    if (active !== value && value === "delivery") setQuote(null);
    setActive(active === value ? null : value);
  };
  return (
    <section className="enquiry-checks" aria-labelledby={`${id}-title`}>
      <div className="enquiry-checks-heading">
        <h3 id={`${id}-title`}>Checks & delivery</h3>
        <span>On demand</span>
      </div>
      <div
        className="enquiry-checks-tools"
        role="group"
        aria-label="Customer enquiry checks"
      >
        <button
          type="button"
          aria-expanded={active === "mot"}
          aria-controls={`${id}-mot`}
          onClick={() => open("mot")}
        >
          <strong>MOT history</strong>
          <span>{stockRegistration || "Registration needed"}</span>
        </button>
        {partExchangeEnabled && (
          <button
            type="button"
            aria-expanded={active === "exchange"}
            aria-controls={`${id}-exchange`}
            onClick={() => open("exchange")}
          >
            <strong>Part exchange</strong>
            <span>{entry.partExchangeRegistration || "Identify the car"}</span>
          </button>
        )}
        <button
          type="button"
          aria-expanded={active === "delivery"}
          aria-controls={`${id}-delivery`}
          onClick={() => open("delivery")}
        >
          <strong>Delivery estimate</strong>
          <span>
            {deliveryEnabled ? "Road miles & price" : "Confirm with showroom"}
          </span>
        </button>
      </div>
      {active === "mot" && (
        <div className="enquiry-checks-content" id={`${id}-mot`}>
          {stockVehicleId && stockRegistration ? (
            <>
              <MotHistoryPanel
                vehicleId={stockVehicleId}
                staff
                autoLoad
                onHistory={setHistory}
              />
              {history && onInsertText && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => insert(enquiryMotSummary(history))}
                >
                  Add MOT details to reply
                </Button>
              )}
            </>
          ) : (
            <p className="enquiry-checks-note">
              {stockVehicleId
                ? "This car has no registration recorded. Ask the showroom for the registration before checking MOT history."
                : "Choose a stock car on this enquiry to check its MOT history."}
            </p>
          )}
        </div>
      )}
      {active === "exchange" && (
        <div className="enquiry-checks-content" id={`${id}-exchange`}>
          <p className="enquiry-checks-note">
            Identify the customer’s car and estimate mileage from its own
            recorded MOT history. These checks do not change the enquiry or an
            invoice.
          </p>
          <label className="enquiry-checks-registration">
            Part-exchange registration
            <input
              value={registration}
              maxLength={20}
              placeholder="AB12 CDE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => {
                setRegistration(event.target.value.toUpperCase());
                setCheckedRegistration("");
                setEstimatedMileage("");
              }}
            />
          </label>
          {registration.trim() && !validExchangeRegistration && (
            <p className="enquiry-checks-note">
              Enter a complete UK registration, for example AB12 CDE.
            </p>
          )}
          {entry.partExchangeMileage != null && (
            <p className="enquiry-checks-note">
              Customer supplied:{" "}
              {entry.partExchangeMileage.toLocaleString("en-GB")} miles. Check
              the odometer before agreeing an allowance.
            </p>
          )}
          <div className="enquiry-checks-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!validExchangeRegistration}
              onClick={() => {
                setEstimatedMileage("");
                setCheckedRegistration(registration.trim());
                setEstimateRequest((value) => value + 1);
              }}
            >
              Identify car & estimate mileage
            </Button>
            <PartExchangeMotCheck registration={registration} />
          </div>
          {checkedRegistration && (
            <MotMileageEstimate
              key={`${checkedRegistration}:${estimateRequest}`}
              registration={checkedRegistration}
              mileage={estimatedMileage}
              onEstimate={setEstimatedMileage}
            />
          )}
          {estimatedMileage && onInsertText && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                insert(
                  `For your part exchange (${checkedRegistration}), the estimated mileage is ${Number(estimatedMileage).toLocaleString("en-GB")} miles, based on recorded MOT history and rounded to the nearest 1,000. Please confirm the current odometer reading; this is an estimate, not an agreed mileage or valuation.`,
                )
              }
            >
              Add mileage estimate to reply
            </Button>
          )}
        </div>
      )}
      {active === "delivery" && (
        <div className="enquiry-checks-content" id={`${id}-delivery`}>
          {deliveryEnabled ? (
            <>
              <DeliveryEstimator expanded onEstimate={setQuote} />
              {quote && onInsertText && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    insert(
                      `Estimated delivery to ${quote.postcode}: ${pounds(quote.totalPence)}, based on ${quote.roadMiles.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} one-way road miles (${pounds(quote.basePricePence)} base charge plus ${pounds(quote.pricePerMilePence)} per mile). The showroom will confirm the final price and delivery availability. Nothing has been booked or charged.`,
                    )
                  }
                >
                  Add delivery estimate to reply
                </Button>
              )}
            </>
          ) : (
            <p className="enquiry-checks-note">
              Online delivery estimates are not enabled for this dealership.
              Confirm delivery availability and price with the showroom before
              advising the customer.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Mounted only in the selected, permission-checked record. No per-row checks or writes. */
export function EnquiryChecks({ canManage, ...props }: EnquiryChecksProps) {
  if (!canManage) return null;
  const identity = [
    props.entry.id,
    props.car?.id || props.entry.vehicleId,
    props.car
      ? vehicleRegistration(props.car)
      : props.entry.vehicleRegistration,
    props.entry.partExchangeRegistration,
  ].join(":");
  return <ChecksContent key={identity} {...props} />;
}
