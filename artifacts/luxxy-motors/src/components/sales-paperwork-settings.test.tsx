import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SalesPaperworkSettings } from './sales-paperwork-settings';
import { defaultInvoiceSettings } from '@workspace/vehicle-meta';
afterEach(() => vi.unstubAllGlobals());
it('saves revised terms with a revision and JSON content type, keeping issued documents intact', async () => {
  const initial = { revision: 2, saleTerms: 'Approved terms', reservationTerms: 'Deposit terms' };
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'PUT') {
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ expectedRevision: 2, reservationTerms: initial.reservationTerms, saleTerms: 'Updated approved terms', invoiceSettings:defaultInvoiceSettings });
      return Response.json({ ...initial, revision: 3, saleTerms: 'Updated approved terms' });
    }
    return Response.json(initial);
  }));
  render(<SalesPaperworkSettings />);
  await screen.findByRole('tab',{name:'Terms'});
  fireEvent.click(screen.getByRole('tab',{name:'Terms'}));
  const terms = screen.getByLabelText('Terms and conditions of sale');
  expect(screen.getByRole('button', { name: 'Save document settings' })).toBeDisabled();
  fireEvent.change(terms, { target: { value: 'Updated approved terms' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save document settings' }));
  await screen.findByText('Document settings saved. Existing issued documents keep their original design, reference and terms.');
  expect(screen.getByRole('button', { name: 'Save document settings' })).toBeDisabled();
});
it('shows A4 wording limits, preserves oversized historic wording and requires an explicit preview', async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({revision:1,saleTerms:'x'.repeat(601),reservationTerms:'',invoiceSettings:defaultInvoiceSettings})));
  render(<SalesPaperworkSettings/>);
  await screen.findByRole('tab',{name:'Terms'});
  fireEvent.click(screen.getByRole('tab',{name:'Terms'}));
  const terms=screen.getByLabelText('Terms and conditions of sale');
  expect(terms).toHaveAttribute('maxlength','600');
  expect(terms).toHaveValue('x'.repeat(601));
  expect(screen.getByLabelText('Thank-you / footer wording')).toHaveAttribute('maxlength','120');
  expect(screen.getByLabelText('Payment instructions')).toHaveAttribute('maxlength','240');
  expect(screen.getByRole('button',{name:'Save document settings'})).toBeDisabled();
  fireEvent.click(screen.getByRole('tab',{name:'Design'}));
  expect(screen.getByRole('button',{name:'Check A4 preview'})).toBeDisabled();
  fireEvent.click(screen.getByRole('tab',{name:'Terms'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Nothing has been removed automatically');
  fireEvent.change(terms,{target:{value:'Short approved terms'}});
  expect(screen.getByRole('button',{name:'Save document settings'})).toBeEnabled();
  fireEvent.click(screen.getByRole('tab',{name:'Design'}));
  expect(screen.getByText('Your invoice preview will appear here.')).toBeVisible();
});
it('shows save failures as errors and retains unsaved terms for retry', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'PUT'
    ? Response.json({ error: 'Changed elsewhere' }, { status: 409 })
    : Response.json({ revision: 2, saleTerms: 'Original', reservationTerms: 'Deposit' })));
  render(<SalesPaperworkSettings />);
  await screen.findByRole('tab',{name:'Terms'});
  fireEvent.click(screen.getByRole('tab',{name:'Terms'}));
  const terms = screen.getByLabelText('Terms and conditions of sale');
  fireEvent.change(terms, { target: { value: 'Retained draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save document settings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(terms).toHaveValue('Retained draft');
});

it('keeps unsaved design, payment and terms edits between tabs and saves them together',async()=>{
 const writes:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  const initial={revision:4,saleTerms:'Original terms',reservationTerms:'Deposit terms',invoiceSettings:defaultInvoiceSettings};
  if(init?.method==='PUT'){const body=JSON.parse(init.body);writes.push(body);return Response.json({...body,revision:5});}
  return Response.json(initial);
 }));
 render(<SalesPaperworkSettings/>);await screen.findByRole('tab',{name:'Design'});
 fireEvent.change(screen.getByLabelText('Logo size'),{target:{value:'large'}});
 fireEvent.click(screen.getByRole('tab',{name:'Payment details'}));
 expect(screen.getByRole('tabpanel',{name:'Payment details'})).toBeVisible();
 expect(screen.queryByRole('tabpanel',{name:'Design'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Payment instructions'),{target:{value:'Use the invoice reference when paying.'}});
 fireEvent.change(screen.getByLabelText('Dealer reference prefix'),{target:{value:'abcd'}});
 fireEvent.click(screen.getByRole('tab',{name:'Terms'}));
 fireEvent.change(screen.getByLabelText('Terms and conditions of sale'),{target:{value:'New approved terms'}});
 fireEvent.click(screen.getByRole('tab',{name:'Design'}));
 expect(screen.getByLabelText('Logo size')).toHaveValue('large');
 fireEvent.click(screen.getByRole('tab',{name:'Payment details'}));
 expect(screen.getByLabelText('Payment instructions')).toHaveValue('Use the invoice reference when paying.');
 expect(screen.getByLabelText('Dealer reference prefix')).toHaveValue('ABCD');
 expect(writes).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Save document settings'}));
 await waitFor(()=>expect(writes).toHaveLength(1));
 expect(writes[0]).toMatchObject({expectedRevision:4,saleTerms:'New approved terms',invoiceSettings:{logoSize:'large',referencePrefix:'ABCD',paymentInstructions:'Use the invoice reference when paying.'}});
});


it('only shows relevant colour and logo controls while preserving their saved values', async () => {
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({revision:1,saleTerms:'',reservationTerms:'',invoiceSettings:defaultInvoiceSettings})));
 render(<SalesPaperworkSettings/>);
 await screen.findByRole('tab',{name:'Design'});
 expect(screen.queryByLabelText('Invoice colour')).not.toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('Use website colour'));
 expect(screen.getByLabelText('Invoice colour')).toHaveValue(defaultInvoiceSettings.accent);
 fireEvent.change(screen.getByLabelText('Design style'),{target:{value:'understated'}});
 expect(screen.queryByLabelText('Invoice colour')).not.toBeInTheDocument();
 expect(screen.queryByLabelText('Use website colour')).not.toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('Show dealership logo'));
 expect(screen.queryByLabelText('Logo size')).not.toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('Show dealership logo'));
 expect(screen.getByLabelText('Logo size')).toHaveValue(defaultInvoiceSettings.logoSize);
});
