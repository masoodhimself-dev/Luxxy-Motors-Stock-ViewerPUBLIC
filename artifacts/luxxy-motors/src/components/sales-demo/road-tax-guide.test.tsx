import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RoadTaxGuide } from './road-tax-guide';
import { cleanSaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { emptyDraft, errors } from './model';
import { roadTaxGuidePdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
it('offers only an invoice attachment, with no separate send, download or no-logbook option', () => {
 const onChange=vi.fn(), onReferenceChange=vi.fn();
 const {rerender}=render(<RoadTaxGuide enabled={false} reference="" onChange={onChange} onReferenceChange={onReferenceChange}/>);
 expect(screen.queryByLabelText('Green slip document number (V5C/2)')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Attach a Road Tax guide to the invoice email?'),{target:{value:'yes'}});
 expect(onChange).toHaveBeenCalledWith(true);expect(onReferenceChange).toHaveBeenCalledWith('');
 rerender(<RoadTaxGuide enabled reference="" onReferenceChange={onReferenceChange}/>);
 expect(screen.getByLabelText('Green slip document number (V5C/2)')).toHaveAttribute('type','password');
 expect(screen.queryByRole('button')).not.toBeInTheDocument();expect(screen.queryByText(/V62|no logbook/i)).not.toBeInTheDocument();
});
it('validates the reference and explains that it is only shared with the invoice email', () => {
 const update=vi.fn();render(<RoadTaxGuide enabled reference="123" onReferenceChange={update} invoiceReady customerEmail="buyer@example.invalid"/>);
 expect(screen.getByRole('alert')).toHaveTextContent('12 digits');
 expect(screen.getByText(/when you email this full invoice to buyer/)).toBeInTheDocument();
 expect(screen.queryByLabelText('Attach a Road Tax guide to the invoice email?')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Green slip document number (V5C/2)'),{target:{value:'0123 4567 8901'}});expect(update).toHaveBeenCalledWith('012345678901');
});
it('persists VIN and attachment preference but never the slip', () => {
 const draft={...emptyDraft(),vin:'wvWZZZ1JZXW000001',roadTaxGuide:true,greenSlipReference:'123456789012'};
 const cleaned=cleanSaleWorkspaceDraft(draft,'sale');expect(cleaned.vin).toBe('WVWZZZ1JZXW000001');expect(cleaned.roadTaxGuide).toBe(true);expect(JSON.stringify(cleaned)).not.toContain('123456789012');
 expect(()=>cleanSaleWorkspaceDraft({...draft,vin:'INVALID'},'sale')).toThrow('17-character VIN');
 expect(errors({...emptyDraft(),customer:'Buyer',vehicleId:'car',price:'5000',vin:'INVALID'})).toContain('Enter the 17-character VIN from the vehicle or log book (no I, O or Q).');
});
it('retains the designed A4 green-slip guide', () => {
 const input={registration:'AB20XYZ',vin:'WVWZZZ1JZXW000001',vehicle:'Ford Focus',reference:'123456789012'};
 const pdf=new TextDecoder().decode(roadTaxGuidePdfBytes(input));expect(pdf).toContain('123456789012');expect(pdf).toContain('https://www.gov.uk/vehicle-tax');expect(pdf).toContain('/MediaBox [0 0 595.');expect(pdf).not.toContain('V62');
 expect(()=>roadTaxGuidePdfBytes({...input,reference:'abc'})).toThrow();
});
