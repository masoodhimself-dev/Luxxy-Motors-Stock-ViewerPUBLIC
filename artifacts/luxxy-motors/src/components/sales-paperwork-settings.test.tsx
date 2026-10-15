import { fireEvent, render, screen } from '@testing-library/react';
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
  const terms = await screen.findByLabelText('Terms and conditions of sale');
  expect(screen.getByRole('button', { name: 'Save document settings' })).toBeDisabled();
  fireEvent.change(terms, { target: { value: 'Updated approved terms' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save document settings' }));
  await screen.findByText('Document settings saved. Existing issued documents keep their original design, reference and terms.');
  expect(screen.getByRole('button', { name: 'Save document settings' })).toBeDisabled();
});
it('shows A4 wording limits, preserves oversized historic wording and requires an explicit preview', async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({revision:1,saleTerms:'x'.repeat(601),reservationTerms:'',invoiceSettings:defaultInvoiceSettings})));
  render(<SalesPaperworkSettings/>);
  const terms=await screen.findByLabelText('Terms and conditions of sale');
  expect(terms).toHaveAttribute('maxlength','600');
  expect(terms).toHaveValue('x'.repeat(601));
  expect(screen.getByLabelText('Thank-you / footer wording')).toHaveAttribute('maxlength','120');
  expect(screen.getByLabelText('Payment instructions')).toHaveAttribute('maxlength','240');
  expect(screen.getByRole('button',{name:'Save document settings'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Check A4 preview'})).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Nothing has been removed automatically');
  fireEvent.change(terms,{target:{value:'Short approved terms'}});
  expect(screen.getByRole('button',{name:'Save document settings'})).toBeEnabled();
  expect(screen.getByText('Your invoice preview will appear here.')).toBeInTheDocument();
});
it('shows save failures as errors and retains unsaved terms for retry', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'PUT'
    ? Response.json({ error: 'Changed elsewhere' }, { status: 409 })
    : Response.json({ revision: 2, saleTerms: 'Original', reservationTerms: 'Deposit' })));
  render(<SalesPaperworkSettings />);
  const terms = await screen.findByLabelText('Terms and conditions of sale');
  fireEvent.change(terms, { target: { value: 'Retained draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save document settings' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(terms).toHaveValue('Retained draft');
});
