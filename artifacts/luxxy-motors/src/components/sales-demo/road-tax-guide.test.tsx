import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RoadTaxGuide } from './road-tax-guide';
import { cleanSaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { emptyDraft, errors } from './model';
import { roadTaxGuidePdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
it('only asks for the green slip when Yes is chosen and requires 12 digits', () => {
 const onChange=vi.fn(); const {rerender}=render(<RoadTaxGuide registration="AB20XYZ" vin="" vehicle="Ford Focus" enabled={false} onChange={onChange}/>);
 expect(screen.queryByLabelText('Green slip document number (V5C/2)')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Generate a Road Tax guide?'),{target:{value:'yes'}});expect(onChange).toHaveBeenCalledWith(true);
 rerender(<RoadTaxGuide registration="AB20XYZ" vin="" vehicle="Ford Focus" enabled onChange={onChange}/>);
 fireEvent.change(screen.getByLabelText('Green slip document number (V5C/2)'),{target:{value:'123'}});
 expect(screen.getByRole('button',{name:'Download guide'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('12 digits');
});
it('downloads locally and clears the sensitive reference', async () => {
 const create=vi.fn(()=> 'blob:test');Object.defineProperty(URL,'createObjectURL',{value:create,configurable:true});Object.defineProperty(URL,'revokeObjectURL',{value:vi.fn(),configurable:true});
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 render(<RoadTaxGuide registration="AB20XYZ" vin="" vehicle="Ford Focus" enabled onChange={()=>{}}/>);
 const field=screen.getByLabelText('Green slip document number (V5C/2)');fireEvent.change(field,{target:{value:'123456789012'}});
 fireEvent.click(screen.getByRole('button',{name:'Download guide'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Guide downloaded'));
 expect(field).toHaveValue('');expect(create).toHaveBeenCalledOnce();vi.restoreAllMocks();
});
it('persists VIN and guide choice but strips green slip references from sale data', () => {
 const draft={...emptyDraft(),vin:'wvWZZZ1JZXW000001',roadTaxGuide:true,greenSlipReference:'123456789012'};
 const cleaned=cleanSaleWorkspaceDraft(draft,'sale');expect(cleaned.vin).toBe('WVWZZZ1JZXW000001');expect(cleaned.roadTaxGuide).toBe(true);expect(JSON.stringify(cleaned)).not.toContain('123456789012');
 expect(()=>cleanSaleWorkspaceDraft({...draft,vin:'INVALID'},'sale')).toThrow('17-character VIN');
 expect(errors({...emptyDraft(),customer:'Buyer',vehicleId:'car',price:'5000',vin:'INVALID'})).toContain('Enter the 17-character VIN from the vehicle or log book (no I, O or Q).');
 expect(cleanSaleWorkspaceDraft(emptyDraft(),'legacy').vin).toBe('');
});
it('creates an A4 guide and rejects malformed references', () => {
 const input={registration:'AB20XYZ',vin:'WVWZZZ1JZXW000001',vehicle:'Ford Focus',reference:'123456789012'};
 const pdf=new TextDecoder().decode(roadTaxGuidePdfBytes(input));expect(pdf).toContain('123456789012');expect(pdf).toContain('https://www.gov.uk/vehicle-tax');expect(pdf).toContain('/MediaBox [0 0 595.');
 expect(()=>roadTaxGuidePdfBytes({...input,reference:'abc'})).toThrow();
});

it('requires recipient confirmation before emailing and clears the slip afterwards', async () => {
 const send=vi.fn().mockResolvedValue(undefined);
 render(<RoadTaxGuide registration="AB20XYZ" vin="" vehicle="Ford Focus" enabled customerEmail="buyer@example.invalid" onEmail={send} onChange={()=>{}}/>);
 const field=screen.getByLabelText('Green slip document number (V5C/2)');fireEvent.change(field,{target:{value:'012345678901'}});
 const button=screen.getByRole('button',{name:'Email guide to customer'});expect(button).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox',{name:/Send this guide to buyer/}));fireEvent.click(button);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('accepted for delivery'));
 expect(send).toHaveBeenCalledWith('012345678901','green-slip',expect.any(String));expect(field).toHaveValue('');
});
it('no-logbook route removes the slip field and provides a V62 guide without a reference', () => {
 render(<RoadTaxGuide registration="AB20XYZ" vin="" vehicle="Ford Focus" enabled route="no-logbook" onChange={()=>{}}/>);
 expect(screen.queryByLabelText('Green slip document number (V5C/2)')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Download guide'})).toBeEnabled();
 expect(screen.getByText(/A new buyer without the green slip/)).toBeInTheDocument();
 const pdf=new TextDecoder().decode(roadTaxGuidePdfBytes({registration:'AB20XYZ',vin:'',vehicle:'Ford Focus',reference:'123456789012',route:'no-logbook'}));
 expect(pdf).toContain('V62');expect(pdf).not.toContain('123456789012');
});
