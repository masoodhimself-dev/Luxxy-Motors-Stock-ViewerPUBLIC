import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultWhatsAppTemplates, whatsappTemplateVariables } from '@workspace/vehicle-meta';
import { whatsappTemplatesQueryKey } from '@/lib/whatsapp-templates';
import { WhatsAppTemplateSettings } from './whatsapp-template-settings';

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><WhatsAppTemplateSettings /></QueryClientProvider>);
  return client;
}
function api(options: { conflict?: boolean; loadFailure?: boolean } = {}) {
  let revision = 4;
  const templates = defaultWhatsAppTemplates.map(template => ({ ...template, customised: false }));
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    expect(String(url)).toBe('/api/staff/whatsapp-templates');
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body); writes.push(body);
      if (options.conflict) { revision++; return Response.json({ error: 'These WhatsApp templates changed. Reload before saving.' }, { status: 409 }); }
      expect(body.expectedRevision).toBe(revision); revision++;
      const saved = templates.find(template => template.id === body.id)!;
      if (body.reset) { saved.body = defaultWhatsAppTemplates.find(template => template.id === body.id)!.body; saved.customised = false; }
      else { saved.body = body.body.trim(); saved.customised = true; }
    } else if (options.loadFailure) return Response.json({ error: 'Unavailable' }, { status: 503 });
    return Response.json({ revision, templates, variables: whatsappTemplateVariables });
  }));
  return { writes, templates };
}

it('previews fictional wording without saving, sending or changing email templates', async () => {
  const { writes } = api(); show();
  await screen.findByLabelText('WhatsApp message');
  expect(screen.getByRole('complementary', { name: 'WhatsApp wording preview' })).toHaveTextContent('Here are the details we discussed.');
  fireEvent.change(screen.getByLabelText('Choose a WhatsApp message'), { target: { value: 'vehicle_details' } });
  expect(screen.getByRole('complementary', { name: 'WhatsApp wording preview' })).toHaveTextContent('Alex Taylor');
  expect(screen.getByRole('complementary', { name: 'WhatsApp wording preview' })).toHaveTextContent('Example Motors');
  expect(screen.getByText(/Required car, appointment and invoice details/)).toBeInTheDocument();
  expect(screen.getByText(/Email wording stays separate/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save WhatsApp template' })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

it('saves exactly one chosen template with its revision and updates consumers', async () => {
  const { writes } = api(); const client = show();
  fireEvent.change(await screen.findByLabelText('WhatsApp message'), { target: { value: 'Hi {{customer_name}}, thanks for calling {{dealer_name}}.' } });
  expect(screen.getByRole('region', { name: 'WhatsApp message templates' })).toHaveAttribute('data-settings-dirty', 'true');
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save WhatsApp template' }));
  await screen.findByText('WhatsApp template saved. Staff can choose it when preparing a message.');
  expect(writes).toEqual([{ expectedRevision: 4, id: 'enquiry', body: 'Hi {{customer_name}}, thanks for calling {{dealer_name}}.' }]);
  expect(client.getQueryData(whatsappTemplatesQueryKey)).toMatchObject({ revision: 5 });
  expect(screen.getByText('Your saved wording')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save WhatsApp template' })).toBeDisabled();
});

it('keeps dirty wording on a refused template change and undoes it without a write', async () => {
  const { writes } = api(); vi.stubGlobal('confirm', vi.fn().mockReturnValue(false)); show();
  fireEvent.change(await screen.findByLabelText('WhatsApp message'), { target: { value: 'A draft to keep' } });
  fireEvent.change(screen.getByLabelText('Choose a WhatsApp message'), { target: { value: 'appointment' } });
  expect(screen.getByLabelText('Choose a WhatsApp message')).toHaveValue('enquiry');
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('A draft to keep');
  fireEvent.click(screen.getByRole('button', { name: 'Undo wording changes' }));
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue(defaultWhatsAppTemplates.find(template => template.id === 'enquiry')!.body);
  expect(writes).toHaveLength(0);
});

it('inserts allowed details at the cursor and rejects unsupported placeholders safely', async () => {
  api(); show();
  const field = await screen.findByLabelText('WhatsApp message') as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: 'Hi , please call us.' } });
  field.setSelectionRange(3, 3);
  fireEvent.click(screen.getByText('Insert a customer detail'));
  fireEvent.click(screen.getByRole('button', { name: 'Customer name' }));
  expect(field).toHaveValue('Hi {{customer_name}}, please call us.');
  expect(screen.getByRole('complementary', { name: 'WhatsApp wording preview' })).toHaveTextContent('Hi Alex Taylor, please call us.');
  fireEvent.change(field, { target: { value: 'Hello {{private_api_key}}' } });
  expect(screen.getByRole('button', { name: 'Save WhatsApp template' })).toBeDisabled();
  expect(screen.getByText('Correct the message wording to see the sample.')).toBeInTheDocument();
});

it('requires a concrete confirmation before restoring the default', async () => {
  const { writes } = api(); const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal('confirm', confirm); show();
  await screen.findByLabelText('WhatsApp message');
  fireEvent.click(screen.getByRole('button', { name: 'Restore default wording' }));
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Replace the .+ WhatsApp wording with the default and save it/));
  expect(writes).toHaveLength(0);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Restore default wording' }));
  await screen.findByText('Default WhatsApp wording restored.');
  expect(writes).toEqual([{ expectedRevision: 4, id: 'enquiry', reset: true }]);
});

it('does not let a background refresh overwrite edits or advance their save revision', async () => {
  const { writes } = api(); const client = show();
  fireEvent.change(await screen.findByLabelText('WhatsApp message'), { target: { value: 'Unsaved local wording' } });
  act(() => { client.setQueryData(whatsappTemplatesQueryKey, { revision: 9, templates: defaultWhatsAppTemplates.map(template => ({ ...template, body: 'Changed elsewhere' })), variables: whatsappTemplateVariables }); });
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('Unsaved local wording');
  fireEvent.click(screen.getByRole('button', { name: 'Save WhatsApp template' }));
  await screen.findByText('WhatsApp template saved. Staff can choose it when preparing a message.');
  expect(writes[0].expectedRevision).toBe(4);
});

it('keeps edits after a conflict and only replaces them on an approved reload', async () => {
  api({ conflict: true }); const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal('confirm', confirm); show();
  fireEvent.change(await screen.findByLabelText('WhatsApp message'), { target: { value: 'Unsaved draft after a conflict' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save WhatsApp template' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('Unsaved draft after a conflict');
  fireEvent.click(screen.getByRole('button', { name: 'Reload WhatsApp templates' }));
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('Unsaved draft after a conflict');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload WhatsApp templates' }));
  await waitFor(() => expect(screen.getByLabelText('WhatsApp message')).toHaveValue(defaultWhatsAppTemplates.find(template => template.id === 'enquiry')!.body));
});

it('does not expose a usable editor when template loading fails', async () => {
  api({ loadFailure: true }); show();
  expect(await screen.findByRole('alert')).toHaveTextContent('WhatsApp templates could not be loaded.');
  expect(screen.queryByLabelText('WhatsApp message')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload WhatsApp templates' })).toBeEnabled();
});
