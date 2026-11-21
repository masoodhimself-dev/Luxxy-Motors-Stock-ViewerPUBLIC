import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WEBSITE_TEMPLATES } from '@workspace/vehicle-meta';
import { PlatformWebsiteTemplates } from './platform-website-templates';

const fixture = (dealerId = 'dealer-one', currentTemplate = 'existing', revision = 7) => ({ dealerId, currentTemplate, revision, templates: WEBSITE_TEMPLATES, previewPath: `/platform/preview/${dealerId}` });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
const show = () => render(<PlatformWebsiteTemplates dealerId="dealer-one" dealerName="Harbour Motor Co" status="active"/>);
async function preview(name = 'Showroom') {
  fireEvent.click(await screen.findByRole('radio', { name: new RegExp(`^${name}\\b`) }));
  fireEvent.click(screen.getByRole('link', { name: /Open private preview/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'I’ve checked this preview' }));
}

it.each([['Apex Motorworks', 'autodeal'], ['Regent Lane', 'regent-lane']])('shows seven designs without changing anything when %s is previewed', async (name, id) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(fixture())); vi.stubGlobal('fetch', fetcher); show();
  const group = await screen.findByRole('group', { name: 'Choose a website design' });
  expect(within(group).getAllByRole('radio')).toHaveLength(7);
  expect(screen.getByRole('heading', { name: 'Website design' }).parentElement).toHaveTextContent('Harbour Motor Co');
  expect(screen.queryByRole('button', { name: 'Create demo links' })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${name}\\b`) }));
  const link = screen.getByRole('link', { name: /Open private preview/ });
  expect(link).toHaveAttribute('href', `/platform/preview/dealer-one/template/${id}/7`);
  fireEvent.click(link);
  expect(screen.getByRole('button', { name: `Apply ${name}` })).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('requires the selected preview, review checkbox and final confirmation before applying', async () => {
  const fetcher = vi.fn(async (_url, init) => Response.json(init?.method === 'PATCH' ? { dealerId: 'dealer-one', currentTemplate: 'modern-showroom', revision: 8 } : fixture()));
  vi.stubGlobal('fetch', fetcher); show();
  await preview('Modern Showroom');
  fireEvent.click(screen.getByRole('button', { name: 'Apply Modern Showroom' }));
  const confirmation = screen.getByRole('alertdialog');
  expect(confirmation).toHaveTextContent('Customers will see this design');
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Apply design' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Modern Showroom applied to Harbour Motor Co.');
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH');
  expect(patch?.[0]).toBe('/api/platform/dealers/dealer-one/website-template');
  expect(new Headers(patch?.[1]?.headers).get('If-Match')).toBe('"7"');
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ template: 'modern-showroom', reviewed: true });
  expect(screen.getByRole('button', { name: 'Apply Modern Showroom' })).toBeDisabled();
});

it('cancels an application and resets review when a different design is chosen', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(fixture())); vi.stubGlobal('fetch', fetcher); show();
  await preview(); fireEvent.click(screen.getByRole('button', { name: 'Apply Showroom' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep current design' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Forecourt/ }));
  expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Apply Forecourt' })).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('blocks a stale apply until saved settings are reloaded and previewed again', async () => {
  let reads = 0;
  const fetcher = vi.fn(async (_url, init) => init?.method === 'PATCH' ? Response.json({ error: 'Revision changed.' }, { status: 409 }) : Response.json(fixture('dealer-one', 'existing', ++reads === 1 ? 7 : 9)));
  vi.stubGlobal('fetch', fetcher); show(); await preview();
  fireEvent.click(screen.getByRole('button', { name: 'Apply Showroom' })); fireEvent.click(screen.getByRole('button', { name: 'Apply design' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('settings changed');
  expect(screen.getByRole('radio', { name: /^Showroom\b/ })).toBeDisabled();
  expect(screen.queryByRole('link', { name: /Open private preview/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved design' }));
  await waitFor(() => expect(screen.getByRole('radio', { name: /^Showroom\b/ })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('radio', { name: /^Showroom\b/ }));
  expect(screen.getByRole('link', { name: /Open private preview/ })).toHaveAttribute('href', '/platform/preview/dealer-one/template/showroom/9');
  expect(screen.getByRole('checkbox')).toBeDisabled();
});

it('drops the previous dealer selection and late responses when changing dealerships', async () => {
  let resolveFirst!: (response: Response) => void;
  const fetcher = vi.fn((url: string) => url.includes('dealer-one') ? new Promise<Response>(resolve => { resolveFirst = resolve; }) : Promise.resolve(Response.json(fixture('dealer-two', 'forecourt', 2))));
  vi.stubGlobal('fetch', fetcher); const view = show();
  view.rerender(<PlatformWebsiteTemplates dealerId="dealer-two" dealerName="Second Motors" status="draft"/>);
  expect(await screen.findByRole('radio', { name: /Forecourt/ })).toBeChecked();
  resolveFirst(Response.json(fixture('dealer-one', 'showroom', 100)));
  await waitFor(() => expect(screen.getByRole('link', { name: /Open private preview/ })).toHaveAttribute('href', '/platform/preview/dealer-two/template/forecourt/2'));
  expect(screen.getByRole('radio', { name: /Forecourt/ })).toBeChecked();
});

it('keeps original designs available and does not apply the current design', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(fixture('dealer-one', 'premium')))); show();
  const originals = await screen.findByRole('combobox', { name: 'Use an original design' });
  expect(originals).toHaveValue('premium');
  expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();
  fireEvent.change(originals, { target: { value: 'existing' } });
  expect(screen.getByRole('link', { name: /Open private preview/ })).toHaveAttribute('href', '/platform/preview/dealer-one/template/existing/7');
});

it('offers a retry without a preview link if loading fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: 'No access' }, { status: 403 })).mockResolvedValueOnce(Response.json(fixture()))); show();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByRole('link', { name: /Open private preview/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('link', { name: /Open private preview/ })).toBeInTheDocument();
});

it('recognises opening the selected preview with a middle click', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(fixture()))); show();
  fireEvent.click(await screen.findByRole('radio', { name: /^Showroom\b/ }));
  fireEvent(screen.getByRole('link', { name: /Open private preview/ }), new MouseEvent('auxclick', { button: 1, bubbles: true }));
  expect(screen.getByRole('checkbox', { name: 'I’ve checked this preview' })).not.toBeDisabled();
});

it('restores a matching preview on return without checking the confirmation or applying it', async () => {
  window.history.replaceState(null, '', '/platform?dealer=dealer-one&tab=Website&previewTemplate=panorama&previewRevision=7');
  const fetcher = vi.fn().mockResolvedValue(Response.json(fixture())); vi.stubGlobal('fetch', fetcher); show();
  expect(await screen.findByRole('radio', { name: /Panorama/ })).toBeChecked();
  expect(screen.getByRole('checkbox')).not.toBeDisabled(); expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Apply Panorama' })).toBeDisabled();
  expect(window.location.search).toBe('?dealer=dealer-one&tab=Website');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not trust a stale preview return to unlock review', async () => {
  window.history.replaceState(null, '', '/platform?dealer=dealer-one&tab=Website&previewTemplate=panorama&previewRevision=6');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(fixture()))); show();
  await screen.findByRole('radio', { name: /Panorama/ });
  expect(screen.getByRole('radio', { name: /Panorama/ })).not.toBeChecked();
  expect(screen.getByRole('checkbox')).toBeDisabled();
});

it('does not restore another dealership’s preview selection', async () => {
  window.history.replaceState(null, '', '/platform?dealer=dealer-two&tab=Website&previewTemplate=panorama&previewRevision=7');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(fixture()))); show();
  await screen.findByRole('radio', { name: /Panorama/ });
  expect(screen.getByRole('radio', { name: /Panorama/ })).not.toBeChecked();
  expect(screen.getByRole('checkbox')).toBeDisabled();
});

it('creates one expiring share link for up to three designs in selection order', async () => {
  const path = '/showcase/demoLinkToken';
  const expiresAt = '2026-11-26T16:30:00.000Z';
  const fetcher = vi.fn(async (_url, init) => Response.json(init?.method === 'POST' ? { path, expiresAt } : fixture()));
  const clipboard = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText: clipboard } });
  render(<PlatformWebsiteTemplates dealerId="dealer-one" dealerName="Harbour Motor Co" status="draft" isDemo />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create demo links' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Create demo links' }));
  expect(dialog.getByRole('combobox', { name: 'Link expires after' })).toHaveValue('7');
  expect(dialog.getByRole('button', { name: 'Create share link' })).toBeDisabled();
  for (const name of ['Regent Lane', 'Apex Motorworks', 'Modern Showroom']) {
    fireEvent.click(dialog.getByRole('checkbox', { name }));
  }
  expect(dialog.getByText('3 of 3 selected')).toBeInTheDocument();
  expect(dialog.getByRole('checkbox', { name: 'Forecourt' })).toBeDisabled();
  fireEvent.change(dialog.getByRole('combobox', { name: 'Link expires after' }), { target: { value: '14' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Create share link' }));

  const share = within(await screen.findByRole('dialog', { name: 'Link ready to share' }));
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toBe('/api/platform/dealers/dealer-one/demo-links');
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ templates: ['regent-lane', 'autodeal', 'modern-showroom'], days: 14 });
  const url = new URL(path, window.location.origin).href;
  expect(share.getByRole('textbox', { name: 'Share link' })).toHaveValue(url);
  expect(share.getByRole('link', { name: 'Open link' })).toHaveAttribute('href', url);
  expect(share.getByText('26 Nov 2026, 16:30')).toHaveAttribute('dateTime', expiresAt);
  fireEvent.click(share.getByRole('button', { name: 'Copy link' }));
  expect(await share.findByRole('status')).toHaveTextContent('Link copied.');
  expect(clipboard).toHaveBeenCalledWith(url);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('discards a late share link when switching dealerships', async () => {
  let resolveLink!: (value: Response) => void;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Promise<Response>(resolve => { resolveLink = resolve; })
    : Response.json(fixture(url.includes('dealer-two') ? 'dealer-two' : 'dealer-one')));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PlatformWebsiteTemplates dealerId="dealer-one" dealerName="Harbour Motor Co" status="draft" isDemo />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create demo links' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Create demo links' }));
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Regent Lane' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Create share link' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));

  view.rerender(<PlatformWebsiteTemplates dealerId="dealer-two" dealerName="Vista Motors" status="draft" isDemo />);
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[1]?.signal?.aborted).toBe(true);
  resolveLink(Response.json({ path: '/showcase/firstDealerToken', expiresAt: '2026-11-26T16:30:00.000Z' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(await screen.findByRole('button', { name: 'Create demo links' }));
  expect(screen.getByRole('dialog', { name: 'Create demo links' })).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Share link' })).not.toBeInTheDocument();
});
