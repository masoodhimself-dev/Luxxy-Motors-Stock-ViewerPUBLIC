import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSearch } from 'wouter';
import { DealerSettingsPanel } from './dealer-settings-panel';
import { clearSettingsDraft, readSettingsDraft } from '@/lib/settings-draft';
import type { DealerSettingsGroup } from '@/lib/settings-simplification';
import { previewSettings } from '../../preview/settings';
const device = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => device.mobile }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({stock:{cars:[]}}) }));
afterEach(() => { device.mobile=false; clearSettingsDraft(); vi.unstubAllGlobals(); sessionStorage.clear(); window.history.replaceState({},'','/'); });
function Harness() { const tab = new URLSearchParams(useSearch()).get('settingsTab'); return <DealerSettingsPanel group={(['dealership','bookings'].includes(tab ?? '') ? tab : 'website') as DealerSettingsGroup} />; }
function setup(settings = structuredClone(previewSettings)) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const writes: typeof settings[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (String(_url).endsWith('/api/features')) return Response.json({features:{testDriveBookings:true,testDriveDeclarations:true,staffAiDrafts:true,customerEmails:true,publicEnquiries:true,partExchange:true},evaluatedAt:'2026-10-25T12:00:00Z'});
    if (init?.method === 'PATCH') { settings = JSON.parse(init.body); writes.push(settings); }
    return Response.json(settings, { headers: { 'x-settings-revision': writes.length ? '5' : '4' } });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  const go = (tab: string, section?: string) => { window.history.replaceState({}, '', `/portal?section=settings&settingsTab=${tab}${section ? `&websiteSection=${section}` : ''}`); fireEvent.popState(window); };
  return { client, writes, go, ...view };
}
it('shares the complete draft across dealership, website and booking areas and publishes once after review', async () => {
  const { client, writes, go } = setup();
  expect(await screen.findByRole('button', {name:'Review changes'})).toBeDisabled();
  fireEvent.change(await screen.findByTestId('input-identity-name'), { target: { value: 'Fictional Test Motors' } });
  go('dealership');
  fireEvent.change(await screen.findByTestId('input-contact-phone'), { target: { value: '07388831790' } });
  go('bookings');
  fireEvent.change(await screen.findByTestId('input-test-drive-durationMinutes'), { target: { value: '45' } });
  go('website');
  expect(await screen.findByTestId('input-identity-name')).toHaveValue('Fictional Test Motors');
  fireEvent.click(screen.getByRole('button', { name:'Review changes' }));
  expect(writes).toHaveLength(0);
  const summary=await screen.findByTestId('settings-change-summary');
  expect(summary).toHaveTextContent('Dealership details');
  expect(summary).toHaveTextContent('Website');
  expect(summary).toHaveTextContent('Bookings');
  expect(within(summary).getByTestId('change-published-contact.phone')).toHaveTextContent(previewSettings.contact.phone);
  expect(within(summary).getByTestId('change-draft-contact.phone')).toHaveTextContent('07388831790');
  fireEvent.click(within(summary).getByText('Public phone number'));
  fireEvent.click(within(summary).getByRole('button',{name:'Edit Public phone number'}));
  expect(await screen.findByTestId('input-contact-phone')).toHaveValue('07388831790');
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name:'Review changes' }));
  fireEvent.click(await screen.findByRole('button', { name:'Publish showroom' }));
  await screen.findByText('Published to the showroom. Your changes are live.');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ identity:{name:'Fictional Test Motors'}, contact:{phone:'07388831790'}, testDriveBooking:{durationMinutes:45} });
  expect(screen.getByRole('button', { name:'Publish showroom' })).toBeDisabled();
  expect(screen.getByTestId('settings-change-summary')).toHaveTextContent('No changes from the loaded publication.');
  client.clear();
});
it('keeps legacy detail links usable and preserves company edits when moving between areas', async () => {
  window.history.replaceState({}, '', '/portal?section=settings&settingsTab=website&websiteSection=legal');
  const { client, go } = setup();
  await screen.findByRole('tab',{name:'Company details',selected:true});
  fireEvent.change(screen.getByTestId('input-legal-company-name'), {target:{value:'Example Limited'}});
  go('website', 'services');
  await screen.findByRole('tab',{name:'Services',selected:true});
  expect(screen.queryByTestId('input-legal-company-name')).not.toBeInTheDocument();
  go('dealership', 'legal');
  expect(await screen.findByTestId('input-legal-company-name')).toHaveValue('Example Limited');
  client.clear();
});
it('removes unused editing controls without removing their saved content or legacy fallback selling points', async () => {
  const settings = structuredClone(previewSettings);
  settings.presentation = { ...settings.presentation, showroomImageUrl:'https://example.test/unused.jpg', showroomImageAlt:'Legacy photo' };
  const { client, writes } = setup(settings);
  fireEvent.change(await screen.findByTestId('input-identity-name'),{target:{value:'New Name'}});
  fireEvent.click(screen.getByRole('tab',{name:'Photos & visits'}));
  expect(screen.queryByTestId('input-showroom-image-url')).not.toBeInTheDocument();
  expect(screen.queryByTestId('test-drive-settings')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:'Homepage'}));
  expect(screen.queryByTestId('input-viewing-title')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:'Services'}));
  expect(screen.getByTestId('input-warranty-title')).toHaveValue(settings.warranty.title);
  fireEvent.click(screen.getByRole('tab',{name:'Selling points'}));
  expect(screen.getByRole('textbox',{name:'Selling point 1 title'})).toHaveValue(settings.whyBuy[0].title);
  expect(screen.queryByRole('textbox',{name:'Trust point 1'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
  fireEvent.click(await screen.findByRole('button',{name:'Publish showroom'}));
  await waitFor(()=>expect(writes).toHaveLength(1));
  expect(writes[0].bookViewing).toEqual(settings.bookViewing);
  expect(writes[0].warranty.title).toBe(settings.warranty.title);
  expect(writes[0].presentation?.showroomImageUrl).toBe(settings.presentation.showroomImageUrl);
  expect(writes[0].trustItems).toEqual(settings.trustItems);
  client.clear();
});
it('uses a weekly timetable only for safe formats and explicitly previews booking hour changes', async () => {
  const settings = structuredClone(previewSettings);
  settings.hours = [{days:'Monday – Saturday',times:'08:00 – 18:00'},{days:'Sunday',times:'Closed'}];
  window.history.replaceState({}, '', '/portal?section=settings&settingsTab=dealership');
  const { client, go, writes } = setup(settings);
  expect(await screen.findByLabelText('Monday opening status')).toHaveValue('open');
  expect(screen.getByLabelText('Sunday opening status')).toHaveValue('closed');
  expect(screen.getByRole('button',{name:'Review changes'})).toBeDisabled();
  go('bookings');
  const monday = await screen.findByLabelText('Monday first appointment');
  expect(monday).toHaveValue('10:00');
  fireEvent.click(screen.getByRole('button',{name:'Use showroom hours…'}));
  expect(monday).toHaveValue('10:00');
  expect(screen.getByTestId('booking-hours-copy-preview')).toHaveTextContent('Monday: 08:00–18:00');
  fireEvent.click(screen.getByRole('button',{name:'Apply these hours to draft'}));
  expect(monday).toHaveValue('08:00');
  expect(writes).toHaveLength(0);
  client.clear();
});
it('keeps custom hours in the text editor and prevents publishing invalid required fields', async () => {
  device.mobile=true;
  window.history.replaceState({}, '', '/portal?section=settings&settingsTab=dealership');
  const { client, go, writes } = setup();
  expect(await screen.findByRole('textbox',{name:'Days for opening hours row 1'})).toHaveValue(previewSettings.hours[0].days);
  go('website');
  fireEvent.change(await screen.findByTestId('input-identity-name'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
  await waitFor(()=>expect(screen.getByTestId('settings-error-summary')).toHaveTextContent('Add the dealership name.'));
  expect(writes).toHaveLength(0);
  client.clear();
});

it('publishes an explicit vehicle-sheet inheritance mode and keeps the saved custom colour available', async () => {
  const settings = structuredClone(previewSettings);
  settings.brochure = {accentColour:'#835b33',footerNote:'Keep this note'};
  const {client,writes} = setup(settings);
  await screen.findByTestId('input-identity-name');
  fireEvent.click(screen.getByRole('tab',{name:'Vehicle sheets'}));
  const inherit = screen.getByRole('checkbox',{name:'Use website colour for vehicle sheets'});
  expect(inherit).not.toBeChecked();
  fireEvent.click(inherit);
  expect(inherit).toBeChecked();
  expect(screen.queryByLabelText(/Print accent colour/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
  fireEvent.click(await screen.findByRole('button',{name:'Publish showroom'}));
  await waitFor(()=>expect(writes).toHaveLength(1));
  expect(writes[0].brochure).toEqual({accentColour:'#835b33',useWebsiteColour:true,footerNote:'Keep this note'});
  fireEvent.click(screen.getByRole('tab',{name:'Vehicle sheets'}));
  expect(screen.getByRole('checkbox',{name:'Use website colour for vehicle sheets'})).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox',{name:'Use website colour for vehicle sheets'}));
  expect(screen.getByLabelText(/Print accent colour/)).toHaveValue('#835b33');
  client.clear();
});

it('keeps an installed demo logo usable when publishing unrelated edits', async () => {
  const settings=structuredClone(previewSettings);settings.identity.logoAsset='/api/demo-logo';
  window.history.replaceState({},'', '/portal?section=settings&settingsTab=website');
  const {client,writes}=setup(settings);
  fireEvent.change(await screen.findByTestId('input-identity-name'),{target:{value:'Demo Motors'}});
  fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
  fireEvent.click(await screen.findByRole('button',{name:'Publish showroom'}));
  await waitFor(()=>expect(writes).toHaveLength(1));
  expect(writes[0].identity.logoAsset).toBe('/api/demo-logo');
  client.clear();
});

it('publishes the dealership Google review link once with the shared contact settings',async()=>{
 const {client,writes,go}=setup();go('dealership','contact');
 fireEvent.change(await screen.findByTestId('input-google-review-link'),{target:{value:'https://g.page/r/test-motors/review'}});
 fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
 fireEvent.click(await screen.findByRole('button',{name:'Publish showroom'}));
 await screen.findByText('Published to the showroom. Your changes are live.');
 expect(writes[0].contact.googleReviewUrl).toBe('https://g.page/r/test-motors/review');client.clear();
});

it('rejects non-Google review links before publishing',async()=>{
 const {client,writes,go}=setup();go('dealership','contact');
 fireEvent.change(await screen.findByTestId('input-google-review-link'),{target:{value:'https://google.com.example.test/review'}});
 fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
 await waitFor(()=>expect(screen.getByTestId('settings-error-summary')).toHaveTextContent('HTTPS Google review link'));
 expect(writes).toHaveLength(0);client.clear();
});

it('edits actual service titles and enforces the API text limits before publishing', async () => {
  const { client, writes, go } = setup();
  await screen.findByTestId('input-identity-name');
  go('website', 'services');
  const title = await screen.findByTestId('input-warranty-title');
  expect(title).toHaveAttribute('maxlength', '120');
  expect(screen.getByTestId('input-warranty-cta')).toHaveAttribute('maxlength', '80');
  expect(screen.getByTestId('textarea-warranty-description')).toHaveAttribute('maxlength', '300');
  fireEvent.change(title, { target: { value: 'Extended warranty options' } });
  fireEvent.change(screen.getByTestId('input-warranty-cta'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(await screen.findByTestId('settings-error-summary')).toHaveTextContent('Warranty button label must be between 1 and 80 characters.');
  expect(writes).toHaveLength(0);
  expect(screen.getByRole('tab', { name: 'Services', selected: true })).toBeInTheDocument();
  fireEvent.change(screen.getByTestId('input-warranty-cta'), { target: { value: 'Ask about cover' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Publish showroom' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].warranty).toMatchObject({ title: 'Extended warranty options', ctaLabel: 'Ask about cover' });
  client.clear();
});

it('blocks a broken WhatsApp contact link and accepts a formatted UK number without rewriting it', async () => {
  const { client, writes, go } = setup();
  go('dealership', 'contact');
  fireEvent.change(await screen.findByTestId('input-contact-whatsapp'), { target: { value: 'hello world' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(await screen.findByTestId('settings-error-summary')).toHaveTextContent('Enter a valid UK WhatsApp number');
  expect(writes).toHaveLength(0);
  fireEvent.change(screen.getByTestId('input-contact-whatsapp'), { target: { value: '07388 831790' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Publish showroom' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].contact.whatsapp).toBe('07388 831790');
  client.clear();
});

it('explains hidden homepage service cards without changing the individual service settings', async () => {
  const settings = structuredClone(previewSettings);
  settings.presentation = {...settings.presentation,servicesEnabled:false};
  const { client, writes, go } = setup(settings);
  await screen.findByTestId('input-identity-name');
  go('website', 'services');
  expect(await screen.findByText(/Your homepage services section is hidden/)).toBeInTheDocument();
  expect(screen.getAllByText('Service enabled')).toHaveLength(3);
  expect(screen.queryByText('Visible on your showroom')).not.toBeInTheDocument();
  expect(screen.getByTestId('checkbox-service-warranty')).toBeChecked();
  expect(writes).toHaveLength(0);
  client.clear();
});

it('uses an accessible discard confirmation, keeps cancellation safe and discards only the shared draft', async () => {
  const settings=structuredClone(previewSettings);
  const nativeConfirm=vi.spyOn(window,'confirm');
  const {client,writes,go}=setup(settings);
  sessionStorage.setItem('unrelated-settings-test','keep this');
  fireEvent.change(await screen.findByTestId('input-identity-name'),{target:{value:'Unpublished dealership'}});
  go('dealership','contact');
  fireEvent.change(await screen.findByTestId('input-contact-phone'),{target:{value:'020 7946 9876'}});
  expect(readSettingsDraft(settings)).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Discard draft'}));
  let dialog=await screen.findByRole('alertdialog',{name:'Discard unpublished settings?'});
  expect(dialog).toHaveTextContent('complete shared draft');
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Keep editing'})).toHaveFocus());
  fireEvent.click(within(dialog).getByRole('button',{name:'Keep editing'}));
  expect(screen.getByTestId('input-contact-phone')).toHaveValue('020 7946 9876');
  expect(readSettingsDraft(settings)).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Discard draft'}));
  dialog=await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button',{name:'Discard draft'}));
  await waitFor(()=>expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByTestId('input-contact-phone')).toHaveValue(settings.contact.phone);
  go('website');
  expect(await screen.findByTestId('input-identity-name')).toHaveValue(settings.identity.name);
  expect(readSettingsDraft(settings)).toBeNull();
  expect(sessionStorage.getItem('unrelated-settings-test')).toBe('keep this');
  expect(writes).toHaveLength(0);
  expect(nativeConfirm).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Review changes'})).toBeDisabled();
  nativeConfirm.mockRestore();
  client.clear();
});
