import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { whatsappTemplateVariables, type WhatsAppTemplate } from '@workspace/vehicle-meta';
import { WhatsAppMessageEditor } from './whatsapp-message-editor';

const clients: QueryClient[] = [];
const savedTemplates: WhatsAppTemplate[] = [{
  id: 'vehicle_details', label: 'Our saved car message',
  body: 'Hi {{customer_name}},\n\nHere is {{vehicle_title}}.\n{{message}}\n\nThanks, {{dealer_name}}',
}];
const settings = { revision: 3, templates: savedTemplates, variables: whatsappTemplateVariables };
const sourceFacts = 'MG HS\nAppointment: Thursday at 10:00\nDeposit invoice: £200 paid\nPrivate document: https://example.test/private-document';
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function show(extra: Partial<React.ComponentProps<typeof WhatsAppMessageEditor>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const props = {
    body: 'Original reviewed message', requiredText: sourceFacts,
    variables: { customer_name: 'Alex Taylor', dealer_name: 'Sample Motors', vehicle_title: 'MG HS', message: 'Here are the photos.' },
    disabled: false, onDirtyChange: vi.fn(), onApply: vi.fn().mockResolvedValue(undefined), ...extra,
  };
  const content = (body = props.body) => <QueryClientProvider client={client}><WhatsAppMessageEditor {...props} body={body} /></QueryClientProvider>;
  return { ...render(content()), props, content };
}
function successfulApi() {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json(settings)); vi.stubGlobal('fetch', fetch); return fetch;
}

it('fills a saved template in one pass, leaving braces inside customer data literal', async () => {
  const fetch = successfulApi();
  const { props } = show({ variables: { customer_name: 'Alex {{dealer_name}}', dealer_name: 'Sample Motors', vehicle_title: 'MG HS {{message}}', message: 'Literal {{customer_name}}' } });
  await screen.findByRole('option', { name: 'Our saved car message' });
  expect(props.onApply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('WhatsApp message template'), { target: { value: 'vehicle_details' } });
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('Hi Alex {{dealer_name}},\n\nHere is MG HS {{message}}.\nLiteral {{customer_name}}\n\nThanks, Sample Motors');
  expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  expect(props.onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Update QR' }));
  await waitFor(() => expect(props.onApply).toHaveBeenCalledExactlyOnceWith('Hi Alex {{dealer_name}},\n\nHere is MG HS {{message}}.\nLiteral {{customer_name}}\n\nThanks, Sample Motors', 'vehicle_details'));
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/staff/whatsapp-templates', expect.anything());
});

it('edits only this customer message and applies it only after Update QR', async () => {
  const fetch = successfulApi(); const { props, rerender, content } = show();
  await screen.findByRole('option', { name: 'Our saved car message' });
  expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText('WhatsApp message'), { target: { value: '  Hello Alex, here is the extra photo you asked for.  ' } });
  expect(screen.getByRole('status')).toHaveTextContent('Update the QR before sending');
  expect(props.onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Update QR' }));
  await waitFor(() => expect(props.onApply).toHaveBeenCalledExactlyOnceWith('Hello Alex, here is the extra photo you asked for.', undefined));
  rerender(content('Hello Alex, here is the extra photo you asked for.'));
  await waitFor(() => expect(props.onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(screen.queryByRole('button', { name: 'Update QR' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.every(([, options]) => !(options as RequestInit | undefined)?.method || (options as RequestInit).method === 'GET')).toBe(true);
});

it('undoes selected template edits without applying or saving them', async () => {
  successfulApi(); const { props } = show();
  await screen.findByRole('option', { name: 'Our saved car message' });
  fireEvent.change(screen.getByLabelText('WhatsApp message template'), { target: { value: 'vehicle_details' } });
  fireEvent.change(screen.getByLabelText('WhatsApp message'), { target: { value: 'An unsaved change' } });
  fireEvent.click(screen.getByRole('button', { name: 'Undo message changes' }));
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('Original reviewed message');
  expect(screen.getByLabelText('WhatsApp message template')).toHaveValue('');
  expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('button', { name: 'Update QR' })).not.toBeInTheDocument();
  expect(props.onApply).not.toHaveBeenCalled();
});

it('allows placeholder-looking strings as literal reviewed message content', async () => {
  successfulApi(); const { props } = show();
  await screen.findByRole('option', { name: 'Our saved car message' });
  fireEvent.change(screen.getByLabelText('WhatsApp message'), { target: { value: 'Your note said {{unknown_customer_note}}. We will check it.' } });
  expect(screen.getByRole('button', { name: 'Update QR' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Update QR' }));
  await waitFor(() => expect(props.onApply).toHaveBeenCalledWith('Your note said {{unknown_customer_note}}. We will check it.', undefined));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps required source facts and private links read-only while wording changes', async () => {
  successfulApi(); const { props } = show();
  await screen.findByRole('option', { name: 'Our saved car message' });
  fireEvent.click(screen.getByText('Details included automatically'));
  const facts = screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === sourceFacts);
  expect(facts).not.toHaveAttribute('contenteditable');
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('WhatsApp message'), { target: { value: 'A shorter greeting' } });
  expect(facts.textContent).toBe(sourceFacts);
  expect(screen.getByLabelText('WhatsApp message')).not.toHaveValue(sourceFacts);
  fireEvent.click(screen.getByRole('button', { name: 'Update QR' }));
  await waitFor(() => expect(props.onApply).toHaveBeenCalledExactlyOnceWith('A shorter greeting', undefined));
  expect(facts.textContent).toBe(sourceFacts);
});

it('keeps edits and shows an update failure without claiming the QR is current', async () => {
  successfulApi(); const onApply = vi.fn().mockRejectedValue(new Error('The sharing link expired. Prepare it again.'));
  const { props } = show({ onApply });
  await screen.findByRole('option', { name: 'Our saved car message' });
  fireEvent.change(screen.getByLabelText('WhatsApp message'), { target: { value: 'Keep this unsaved customer message' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update QR' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The sharing link expired. Prepare it again.');
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('Keep this unsaved customer message');
  expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('button', { name: 'Update QR' })).toBeEnabled();
});

it('holds template selection while loading but keeps manual wording editable', async () => {
  let finish: (value: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  show();
  expect(screen.getByLabelText('WhatsApp message template')).toBeDisabled();
  expect(screen.getByLabelText('WhatsApp message')).toBeEnabled();
  await act(async () => finish(Response.json(settings)));
  expect(await screen.findByRole('option', { name: 'Our saved car message' })).toBeInTheDocument();
  expect(screen.getByLabelText('WhatsApp message template')).toBeEnabled();
});

it('offers a retry after a template load error without discarding manual edits', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Unavailable' }, { status: 503 })).mockResolvedValueOnce(Response.json(settings));
  vi.stubGlobal('fetch', fetch); const { props } = show();
  expect(await screen.findByRole('status')).toHaveTextContent('Saved templates could not be loaded');
  fireEvent.change(screen.getByLabelText('WhatsApp message'), { target: { value: 'My manual wording while templates are unavailable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Retry templates' }));
  await screen.findByRole('option', { name: 'Our saved car message' });
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('My manual wording while templates are unavailable');
  expect(props.onApply).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('blocks blank wording and locks editing and QR updates while busy', async () => {
  successfulApi(); const { props, rerender } = show();
  await screen.findByRole('option', { name: 'Our saved car message' });
  fireEvent.change(screen.getByLabelText('WhatsApp message'), { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Update QR' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('WhatsApp message'), { target: { value: 'Ready to apply' } });
  rerender(<QueryClientProvider client={clients[0]}><WhatsAppMessageEditor {...props} disabled /></QueryClientProvider>);
  expect(screen.getByLabelText('WhatsApp message')).toBeDisabled();
  expect(screen.getByLabelText('WhatsApp message template')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Update QR' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Undo message changes' })).toBeDisabled();
  expect(props.onApply).not.toHaveBeenCalled();
});
