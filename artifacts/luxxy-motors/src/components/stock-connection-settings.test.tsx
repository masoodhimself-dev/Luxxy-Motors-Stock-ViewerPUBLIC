import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StockConnectionSettings } from './stock-connection-settings';
afterEach(() => { vi.unstubAllGlobals(); });
const initial = { revision: 7, connection: { platform: 'autotrader', retailerId: 'example-auto', sourceUrl: 'https://www.autotrader.co.uk/dealers/example', enabled: true }, importSecretConfigured: true, latest: null };
it('hides connection controls when the backend denies platform access', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Only the platform administrator can manage stock connections.' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch); const { container } = render(<StockConnectionSettings />);
  await waitFor(() => expect(fetch).toHaveBeenCalled()); await waitFor(() => expect(container).toBeEmptyDOMElement());
});
it('saves one marketplace with the exact retailer reference and no secret', async () => {
  const fetch = vi.fn(async (_path, init) => {
    if (init?.method === 'PUT') { const body = JSON.parse(init.body); expect(body.expectedRevision).toBe(7); expect(body.connection).toEqual({ platform: 'cazoo', retailerId: 'cazoo-example', sourceUrl: 'https://www.cazoo.co.uk/dealers/example/', enabled: true }); expect(JSON.stringify(body)).not.toContain('secret'); return Response.json({ revision: 8, connection: body.connection }); }
    return Response.json(initial);
  }); vi.stubGlobal('fetch', fetch); render(<StockConnectionSettings />);
  fireEvent.change(await screen.findByLabelText('Marketplace'), { target: { value: 'cazoo' } });
  fireEvent.change(screen.getByLabelText('Retailer reference'), { target: { value: 'cazoo-example' } });
  fireEvent.change(screen.getByLabelText('Authorised stock page'), { target: { value: 'https://www.cazoo.co.uk/dealers/example/' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save stock connection' }));
  await screen.findByText('Stock connection saved. Configure Grok with the same retailer reference.');
});
it('development fixtures are visibly read-only', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...initial, fixtureOnly: true })));
  render(<StockConnectionSettings />); expect(await screen.findByLabelText('Marketplace')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save stock connection' })).toBeDisabled();
});
