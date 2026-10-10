import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultSaleTerms } from '@workspace/vehicle-meta';
import { SalesPaperworkSettings } from './sales-paperwork-settings';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('loads seller defaults, saves invoice overrides with both sets of terms and preserves issued documents', async () => {
  const request = vi.fn(async (path: unknown, init?: RequestInit) => {
    if (path === '/api/dealer-settings') return Response.json({ identity: { name: 'Website Motors' }, contact: { email: 'hello@example.test' } });
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      expect(body.expectedRevision).toBe(3);
      expect(body.invoiceDetails.name).toBe('Invoice Motors');
      expect(body.invoiceDetails.email).toBe('accounts@example.test');
      expect(body.saleTerms).toBe('Custom sale terms');
      expect(body.reservationTerms).toBe('Deposit terms');
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
      return Response.json({ ...body, revision: 4 });
    }
    return Response.json({ revision: 3, saleTerms: defaultSaleTerms, reservationTerms: 'Deposit terms', invoiceDetails: { email: 'accounts@example.test' } });
  });
  vi.stubGlobal('fetch', request);
  render(<SalesPaperworkSettings />);
  const name = await screen.findByLabelText('Dealership name');
  expect(name).toHaveValue('Website Motors');
  expect(screen.getByLabelText('Contact email')).toHaveValue('accounts@example.test');
  fireEvent.change(name, { target: { value: 'Invoice Motors' } });
  fireEvent.change(screen.getByLabelText('Terms of sale'), { target: { value: 'Custom sale terms' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice settings' }));
  await screen.findByText('Invoice settings saved. Existing issued documents keep their original details and terms.');
  fireEvent.click(screen.getByRole('button', { name: 'Use standard terms' }));
  expect(screen.getByLabelText('Terms of sale')).toHaveValue(defaultSaleTerms);
});
