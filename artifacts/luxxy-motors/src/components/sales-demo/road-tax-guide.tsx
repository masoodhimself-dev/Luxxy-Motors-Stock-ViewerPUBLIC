import { Input } from '@/components/ui/input';

export function RoadTaxGuide({ enabled, disabled, onChange, reference, onReferenceChange, invoiceReady = false, customerEmail = '' }: {
  enabled: boolean; disabled?: boolean; onChange?: (value: boolean) => void;
  reference: string; onReferenceChange: (value: string) => void; invoiceReady?: boolean; customerEmail?: string;
}) {
  return <section className="invoice-tax-guide" aria-label="Road Tax guide">
    {!invoiceReady && <label>Attach a Road Tax guide to the invoice email?
      <select value={enabled ? 'yes' : 'no'} disabled={disabled} onChange={event => {
        onReferenceChange(''); onChange?.(event.target.value === 'yes');
      }}><option value="no">No</option><option value="yes">Yes</option></select>
    </label>}
    {enabled && <>
      {invoiceReady && <h3>Invoice & Road Tax guide</h3>}
      <label>Green slip document number (V5C/2)
        <Input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={reference} disabled={disabled}
          onChange={event => onReferenceChange(event.target.value.replace(/\s/g, ''))} aria-describedby={invoiceReady ? 'tax-guide-email-help' : 'tax-guide-review-help'} />
      </label>
      <p id={invoiceReady ? 'tax-guide-email-help' : 'tax-guide-review-help'} className="invoice-note">
        {invoiceReady ? `The guide will be attached when you email this full invoice${customerEmail ? ` to ${customerEmail}` : ''}. ` : 'The guide is attached only when you email the full invoice. '}
        Enter the 12 digits from the latest green slip. This number is not saved with the sale; it is shared with the customer and your email provider in the guide.
      </p>
      {reference && !/^\d{12}$/.test(reference) && <p role="alert">Enter exactly 12 digits.</p>}
      {!invoiceReady && <p className="invoice-note">You can create the invoice now and enter this number before emailing it. The guide does not tax the vehicle.</p>}
    </>}
  </section>;
}
