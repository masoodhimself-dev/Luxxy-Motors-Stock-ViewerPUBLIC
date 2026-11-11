import { useId, useState } from "react";
import { isUKNumberPlate } from "@workspace/vehicle-meta";
import { PartExchangeCheck } from "./part-exchange-check";
import "./enquiry-checks.css";

export function EnquiryTradeInSummary({ registration, mileage, onInsertText }: {
  registration: string;
  mileage?: number | null;
  onInsertText?: (text: string) => void;
}) {
  const [plate, setPlate] = useState(registration);
  const id = useId();
  const invalid = Boolean(plate.trim() && !isUKNumberPlate(plate));

  return (
    <section className="enquiry-case-trade-in" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>Part exchange</h4>
      <label className="enquiry-checks-registration">
        Part-exchange registration
        <input
          value={plate}
          maxLength={20}
          placeholder="AB12 CDE"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-plate-help` : undefined}
          onChange={(event) => setPlate(event.target.value.toUpperCase())}
        />
      </label>
      {invalid && (
        <p className="enquiry-checks-note" id={`${id}-plate-help`}>
          Enter a complete UK registration, for example AB12 CDE.
        </p>
      )}
      <PartExchangeCheck
        registration={plate}
        reportedRegistration={registration}
        reportedMileage={mileage}
        onInsertText={onInsertText}
      />
    </section>
  );
}
