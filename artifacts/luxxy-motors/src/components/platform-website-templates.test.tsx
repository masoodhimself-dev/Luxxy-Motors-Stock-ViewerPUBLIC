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

it('shows six designs without changing anything when Apex Motorworks is chosen or previewed', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(fixture())); vi.stubGlobal('fetch', fetcher); show();
  const group = await screen.findByRole('group', { name: 'Choose a website design' });
  expect(within(group).getAllByRole('radio')).toHaveLength(6);
  expect(screen.getByRole('heading', { name: 'Website design' }).parentElement).toHaveTextContent('Harbour Motor Co');
  expect(screen.getByRole('checkbox')).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: /^Apex Motorworks\b/ }));
  const link = screen.getByRole('link', { name: /Open private preview/ });
  expect(link).toHaveAttribute('href', '/platform/preview/dealer-one/template/autodeal/7');
  fireEvent.click(link);
  expect(screen.getByRole('button', { name: 'Apply Apex Motorworks' })).toBeDisabled();
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
