import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultEmailAppearance, defaultEmailTemplates } from '@workspace/vehicle-meta';
import { DealerIntegrationsSettings } from './dealer-integrations-settings';
import { EmailTemplatesSettings } from './email-templates-settings';
const feature = vi.hoisted(() => ({ enabled: true, loading: false, error: false, refetch: vi.fn() }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ data: { features: { customerEmails: feature.enabled } }, isLoading: feature.loading, isError: feature.error, isFetching: false, refetch: feature.refetch }) }));
let request: ReturnType<typeof vi.fn>;
beforeEach(() => { request = vi.fn(); vi.stubGlobal('fetch', request); feature.enabled = true; feature.loading = false; feature.error = false; feature.refetch.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settings = { revision: 0, preview: true, resend: { enabled: false, apiKeyConfigured: false, from: '', replyTo: '' }, stripe: { enabled: false, mode: 'test', publishableKeyConfigured: false, secretKeyConfigured: false, webhookSecretConfigured: false }, readiness: { resend: { ready: false, issues: ['Add a Resend key.'] }, stripe: { ready: false, issues: ['Add Stripe keys.'] }, message: 'Checked locally. No email or charge made.' } };
it('keeps entered keys out of browser storage and clears them after the private save', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  request.mockImplementation(async (path, init) => {
    if (path !== '/api/dealer-integrations') throw new Error('Unexpected request');
    if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)); expect(body.resend.apiKey).toBe('re_syntheticUiOnly'); expect(body.expectedRevision).toBe(0); return Response.json({ ...settings, revision: 1, resend: { ...settings.resend, apiKeyConfigured: true } }); }
    return Response.json(settings);
  });
  render(<DealerIntegrationsSettings />);
  const key = await screen.findByLabelText(/API key/); expect(key).toHaveAttribute('type', 'password');
  fireEvent.change(key, { target: { value: 're_syntheticUiOnly' } }); fireEvent.click(screen.getByRole('button', { name: 'Save private settings' }));
  await screen.findByText('Private integration settings saved.'); expect(key).toHaveValue(''); expect(storage).not.toHaveBeenCalled();
  expect(screen.getByText('Email and payment requests are disabled on this server.')).toBeInTheDocument();
  expect(request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
});
it('shows active templates first and keeps inactive templates available without changing delivery', async () => {
  const response = { revision: 0, templates: defaultEmailTemplates, appearance: defaultEmailAppearance, variables: ['customer_name', 'dealer_name', 'portal_url'] };
  request.mockImplementation(async (path, init) => {
    if (path === '/api/email-templates') return Response.json(response);
    if (String(path).endsWith('/preview')) { const body = JSON.parse(String(init.body)); if (body.subject === 'A personal receipt') expect(body.appearance.footer).toBe('Call {{dealer_name}} for help.'); return Response.json({ subject: 'A personal receipt', html: '<p>Example customer</p><p>Amount received: £100.00</p>', text: 'Example customer', sent: false }); }
    throw new Error('Unexpected request');
  });
  render(<EmailTemplatesSettings />); const select = await screen.findByLabelText('Choose a message');
  for (const template of defaultEmailTemplates.filter(item=>item.category!=='Reservations')) expect(screen.getByRole('option', { name: template.label })).toBeInTheDocument();
  expect(screen.queryByRole('option',{name:'Reservation confirmation'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show inactive reservation templates'}));
  for (const template of defaultEmailTemplates) expect(screen.getByRole('option',{name:template.label})).toBeInTheDocument();
  await screen.findByText('Preview is current');
  fireEvent.change(select, { target: { value: 'payment_receipt' } }); await screen.findByText('Preview is current'); fireEvent.change(screen.getByLabelText('Subject line'), { target: { value: 'A personal receipt' } }); fireEvent.click(screen.getByRole('tab', { name: 'Branding' })); fireEvent.change(screen.getByLabelText('Footer wording'), { target: { value: 'Call {{dealer_name}} for help.' } }); fireEvent.click(screen.getByRole('tab', { name: 'Messages' })); fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));
  await screen.findByText('Preview is current');
  await waitFor(() => expect(screen.getByTitle('Email preview using sample customer information')).toHaveAttribute('sandbox', ''));
  expect(screen.getByTitle('Email preview using sample customer information')).toHaveAttribute('srcdoc', expect.stringContaining('£100.00'));
  expect(request.mock.calls.filter(([path]) => String(path).endsWith('/preview'))).toHaveLength(3);
  expect(JSON.parse(String(request.mock.calls.filter(([path]) => String(path).endsWith('/preview')).at(-1)?.[1].body)).subject).toBe('A personal receipt');
  expect(request.mock.calls.filter(([path]) => String(path).includes('/email') && !String(path).includes('email-templates'))).toHaveLength(0);
});
it('protects unsaved email wording on template changes and retains branding when saving wording', async () => {
  const initial = { revision: 1, templates: defaultEmailTemplates, appearance: defaultEmailAppearance, variables: [] };
  request.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      return Response.json({ ...initial, revision: 2, templates: initial.templates.map(template => template.id === body.id ? { ...template, subject: body.subject, body: body.body } : template) });
    }
    return Response.json(initial);
  });
  render(<EmailTemplatesSettings />);
  const selector = await screen.findByLabelText('Choose a message');
  await screen.findByText('Preview is current');
  fireEvent.change(screen.getByLabelText('Subject line'), { target: { value: 'Unsaved wording' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.change(selector, { target: { value: 'payment_receipt' } });
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByLabelText('Subject line')).toHaveValue('Unsaved wording');
  fireEvent.click(screen.getByRole('tab', { name: 'Branding' }));
  fireEvent.change(screen.getByLabelText('Footer wording'), { target: { value: 'Unsaved brand footer' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Messages' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
  await screen.findByText('Email template saved. Future emails will use this wording.');
  fireEvent.click(screen.getByRole('tab', { name: 'Branding' }));
  expect(screen.getByLabelText('Footer wording')).toBeVisible();
  expect(screen.getByLabelText('Footer wording')).toHaveValue('Unsaved brand footer');
});

it.each(['unavailable', 'loading', 'error'] as const)('distinguishes the saved email connection from %s effective availability without changing it', async status => {
  feature.enabled = status !== 'unavailable'; feature.loading = status === 'loading'; feature.error = status === 'error';
  request.mockImplementation(async path => {
    if (path !== '/api/dealer-integrations') throw new Error('Unexpected request');
    return Response.json({ ...settings, preview: false, resend: { ...settings.resend, enabled: true, apiKeyConfigured: true }, readiness: { ...settings.readiness, resend: { ready: true, issues: [] } } });
  });
  render(<DealerIntegrationsSettings />);
  await screen.findByRole('heading', { name: 'Email delivery' });
  expect(screen.getByRole('checkbox', { name: 'Enable email delivery' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save private settings' })).toBeDisabled();
  if (status === 'unavailable') expect(screen.getByRole('status', { name: 'Customer email sending availability' })).toHaveTextContent('Customer email sending is currently unavailable for this dealership.');
  else if (status === 'loading') expect(screen.getByText('Checking customer email sending availability…')).toBeVisible();
  else {
    expect(screen.getByRole('status', { name: 'Customer email sending availability' })).toHaveTextContent('availability could not be confirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry availability check' }));
    expect(feature.refetch).toHaveBeenCalledOnce();
  }
  expect(request.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false);
});
