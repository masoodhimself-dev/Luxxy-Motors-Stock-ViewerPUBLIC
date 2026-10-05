import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultEmailAppearance, defaultEmailTemplates } from '@workspace/vehicle-meta';
import { DealerIntegrationsSettings } from './dealer-integrations-settings';
import { EmailTemplatesSettings } from './email-templates-settings';
let request: ReturnType<typeof vi.fn>;
beforeEach(() => { request = vi.fn(); vi.stubGlobal('fetch', request); });
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
it('exposes every message template and previews unsaved wording and branding without sending', async () => {
  const response = { revision: 0, templates: defaultEmailTemplates, appearance: defaultEmailAppearance, variables: ['customer_name', 'dealer_name', 'portal_url'] };
  request.mockImplementation(async (path, init) => {
    if (path === '/api/email-templates') return Response.json(response);
    if (String(path).endsWith('/preview')) { const body = JSON.parse(String(init.body)); expect(body.subject).toBe('A personal receipt'); expect(body.appearance.footer).toBe('Call {{dealer_name}} for help.'); return Response.json({ subject: 'A personal receipt', html: '<p>Example customer</p><p>Amount received: £100.00</p>', text: 'Example customer', sent: false }); }
    throw new Error('Unexpected request');
  });
  render(<EmailTemplatesSettings />); const select = await screen.findByLabelText('Email to customise');
  for (const template of defaultEmailTemplates) expect(screen.getByRole('option', { name: template.label })).toBeInTheDocument();
  fireEvent.change(select, { target: { value: 'payment_receipt' } }); fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'A personal receipt' } }); fireEvent.change(screen.getByLabelText('Email footer'), { target: { value: 'Call {{dealer_name}} for help.' } }); fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() => expect(screen.getByTitle('Email preview using sample customer information')).toHaveAttribute('sandbox', ''));
  expect(screen.getByTitle('Email preview using sample customer information')).toHaveAttribute('srcdoc', expect.stringContaining('£100.00'));
  expect(request.mock.calls.filter(([path]) => String(path).endsWith('/preview'))).toHaveLength(1);
  expect(request.mock.calls.filter(([path]) => String(path).includes('/email') && !String(path).includes('email-templates'))).toHaveLength(0);
});
