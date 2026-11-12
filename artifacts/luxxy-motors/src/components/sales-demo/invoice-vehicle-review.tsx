import { useEffect, useId, useRef, useState } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { formatRegistrationPlate, saleInvoiceMileageMax, type SaleInvoiceVehicleReview, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { AlertCircle, ShieldCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motDateLabel } from '@/lib/mot-mileage-history';
import './invoice-vehicle-review.css';

export type InvoiceVehicleApproval = {
  saleId: string;
  revision: number;
  id: string;
  mileage: number;
  acknowledge: true;
};

const numberLabel = new Intl.NumberFormat('en-GB');

function odometerReading(value: string) {
  if (!/^\d{1,7}$|^\d{1,3}(?:,\d{3}){1,2}$/.test(value.trim())) return null;
  const mileage = Number(value.trim().replaceAll(',', ''));
  return mileage <= saleInvoiceMileageMax ? mileage : null;
}

export function InvoiceVehicleReview({ sale, disabled, onApproval }: {
  sale: SaleWorkspaceRecord;
  disabled?: boolean;
  onApproval: (approval: InvoiceVehicleApproval | null) => void;
}) {
  const id = useId();
  const [review, setReview] = useState<SaleInvoiceVehicleReview | null>(null);
  const [mileageText, setMileageText] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => {
    pending.current?.abort();
    onApproval(null);
  }, [onApproval]);

  const mileage = odometerReading(mileageText);
  const mileageError = Boolean(mileageText && mileage === null);
  const motReading = review?.lastMotMileage;
  const motMiles = motReading && (motReading.unit === 'km' ? Math.round(motReading.reading / 1.609344) : motReading.reading);
  const belowMot = mileage !== null && motMiles !== undefined && mileage < motMiles;
  const savedRegistration = review?.registration || sale.draft.registration;
  const registration = formatRegistrationPlate(savedRegistration) || savedRegistration;
  const dvlaSummary = [review?.dvla?.make, review?.dvla?.yearOfManufacture, review?.dvla?.colour, review?.dvla?.fuelType,
    review?.dvla?.engineCapacity ? `${numberLabel.format(review.dvla.engineCapacity)} cc` : null].filter(Boolean).join(' · ');

  async function checkVehicle() {
    if (disabled || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setReview(null);
    setAccepted(false);
    onApproval(null);
    setChecking(true);
    setProblem('');
    try {
      const result = await customFetch<{ review: SaleInvoiceVehicleReview }>(`/api/sale-workspace/${encodeURIComponent(sale.id)}/invoice-vehicle-review`, {
        method: 'POST', signal: controller.signal, body: JSON.stringify({ expectedRevision: sale.revision }),
      });
      if (controller.signal.aborted) return;
      if (!result.review?.id || !Array.isArray(result.review.warnings)) throw new Error('Invalid vehicle check response.');
      setReview(result.review);
    } catch (error) {
      if (controller.signal.aborted) return;
      const detail = error instanceof HttpApiError ? (error.data as { error?: unknown })?.error : undefined;
      setProblem(typeof detail === 'string' ? detail : 'Could not start the vehicle check. Try again.');
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setChecking(false);
    }
  }

  function confirm(checked: boolean) {
    if (!review || mileage === null) return;
    setAccepted(checked);
    onApproval(checked ? { saleId: sale.id, revision: sale.revision, id: review.id, mileage, acknowledge: true } : null);
  }

  return <section className="invoice-vehicle-review" aria-labelledby={`${id}-heading`}>
    <header className="invoice-vehicle-review-header">
      <div>
        <h3 id={`${id}-heading`}><ShieldCheck size={19} aria-hidden="true" />Vehicle check</h3>
        <p>{registration ? `${sale.draft.vehicle} · ${registration}` : sale.draft.vehicle}</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={disabled || checking} onClick={() => void checkVehicle()}>
        {checking ? 'Checking…' : review ? 'Check again' : 'Check DVLA and MOT'}
      </Button>
    </header>
    {checking && <p className="invoice-vehicle-review-status" role="status">Checking DVLA and MOT records…</p>}
    {problem && <p className="invoice-vehicle-review-warning" role="alert">{problem}</p>}
    {review && <>
      {(review.dvla || review.mot || motReading || review.stockMileage !== undefined) && (
        <dl className="invoice-vehicle-review-facts">
          {review.dvla && <div><dt>DVLA vehicle details</dt><dd>{dvlaSummary || 'Vehicle found'}</dd></div>}
          {review.mot && <div><dt>MOT expiry · {review.mot.source}</dt><dd>{motDateLabel(review.mot.expiryDate)}</dd></div>}
          {motReading && <div><dt>Last MOT reading · DVSA</dt><dd>{numberLabel.format(motReading.reading)} {motReading.unit}
            <small>{motDateLabel(motReading.recordedAt)}</small></dd></div>}
          {review.stockMileage !== undefined && <div><dt>Mileage on stock record</dt><dd>{numberLabel.format(review.stockMileage)} miles</dd></div>}
        </dl>
      )}
      {(review.warnings.length > 0 || review.status !== 'checked' || belowMot) && <div className="invoice-vehicle-review-warning" role="status">
        <AlertCircle size={17} aria-hidden="true" />
        <div>
          {review.status === 'unavailable' && <strong>Check the vehicle and odometer manually.</strong>}
          {review.status === 'needs-review' && <strong>Check these details before saving.</strong>}
          {review.warnings.map(warning => <p key={warning}>{warning}</p>)}
          {belowMot && <p>The current reading is lower than the last MOT reading. Check the dashboard before continuing.</p>}
        </div>
      </div>}
      <div className="invoice-vehicle-review-mileage">
        <label htmlFor={`${id}-mileage`}>Current odometer (miles)</label>
        <Input id={`${id}-mileage`} type="text" inputMode="numeric" maxLength={9} value={mileageText} disabled={disabled}
          aria-invalid={mileageError || undefined} aria-describedby={`${id}-mileage-hint`}
          onChange={event => { setMileageText(event.target.value); setAccepted(false); onApproval(null); }} />
        <p id={`${id}-mileage-hint`}>{mileageError ? 'Enter a whole number from 0 to 2,000,000.' : 'Use the reading on the dashboard.'}</p>
      </div>
      <label className="invoice-vehicle-review-confirm">
        <input type="checkbox" checked={accepted} disabled={disabled || mileage === null} onChange={event => confirm(event.target.checked)} />
        {review.status !== 'checked' ? 'I checked the vehicle manually and confirmed the current odometer reading.'
          : 'I checked the vehicle details and confirmed the current odometer reading.'}
      </label>
    </>}
  </section>;
}
