import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DealerSettingsPanel } from './dealer-settings-panel';
import { clearSettingsDraft } from '@/lib/settings-draft';
import { previewSettings } from '../../preview/settings';
const device = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => device.mobile }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({stock:{cars:[]}}) }));
afterEach(() => { device.mobile=false; clearSettingsDraft(); vi.unstubAllGlobals(); sessionStorage.clear(); window.history.replaceState({},'','/'); });
it('retains changes across sections, reviews before publishing and sends one settings update', async () => {
  sessionStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  let settings = structuredClone(previewSettings);
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'PATCH') { const body = JSON.parse(init.body); writes.push(body); settings = body; }
    return Response.json(settings, {headers:{'x-settings-revision':writes.length ? '5' : '4'}});
  }));
  const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  render(<QueryClientProvider client={client}><DealerSettingsPanel /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('tab',{name:'Brand'}));
  const name = await screen.findByTestId('input-identity-name');
  fireEvent.change(name,{target:{value:'Fictional Test Motors'}});
  fireEvent.click(screen.getByRole('tab',{name:'Showroom'}));
  fireEvent.click(screen.getByRole('tab',{name:'Brand'}));
  expect(screen.getByTestId('input-identity-name')).toHaveValue('Fictional Test Motors');
  fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
  expect(writes).toHaveLength(0);
  fireEvent.click(await screen.findByRole('button',{name:'Publish showroom'}));
  await screen.findByText('Published to the showroom. Your changes are live.');
  expect(writes).toHaveLength(1);
  expect(settings.identity.name).toBe('Fictional Test Motors');
  client.clear();
});
it('prevents publishing an empty dealership name', async () => {
  sessionStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const writes: unknown[]=[];
  vi.stubGlobal('fetch',vi.fn(async (_url,init) => { if(init?.method==='PATCH')writes.push(init.body); return Response.json(previewSettings,{headers:{'x-settings-revision':'4'}}); }));
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><DealerSettingsPanel /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('tab',{name:'Brand'}));
  fireEvent.change(await screen.findByTestId('input-identity-name'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
  await waitFor(()=>expect(screen.getByTestId('settings-error-summary')).toHaveTextContent('Add the dealership name.'));
  expect(writes).toHaveLength(0);client.clear();
});

it('keeps phone website edits across compact tabs and reviews before publishing the draft',async()=>{
 sessionStorage.clear();
 device.mobile=true;
 window.history.replaceState({},'','/portal?section=settings&settingsTab=website');
 HTMLElement.prototype.scrollIntoView=vi.fn();
 let settings=structuredClone(previewSettings);settings.identity.name='Fictional Test Motors';const writes:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{if(init?.method==='PATCH'){settings=JSON.parse(init.body);writes.push(settings);}return Response.json(settings,{headers:{'x-settings-revision':writes.length?'5':'4'}});}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 render(<QueryClientProvider client={client}><DealerSettingsPanel /></QueryClientProvider>);
 await screen.findByRole('tab',{name:'Showroom',selected:true});
 expect(screen.queryByText('Quick changes')).not.toBeInTheDocument();
 const phone=screen.getByTestId('input-contact-phone');
 fireEvent.change(phone,{target:{value:'07388831790'}});
 fireEvent.click(screen.getByRole('tab',{name:'Brand'}));
 expect(window.location.search).toContain('websiteSection=identity');
 fireEvent.click(screen.getByRole('tab',{name:'Showroom'}));
 expect(screen.getByTestId('input-contact-phone')).toHaveValue('07388831790');
 fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
 expect(screen.queryByTestId('settings-error-summary')?.textContent ?? '').toBe('');
 await waitFor(()=>expect(window.location.search).toContain('websiteSection=review'));expect(writes).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Publish showroom'}));
 await screen.findByText('Published to the showroom. Your changes are live.');
 expect(writes).toHaveLength(1);expect(settings.contact.phone).toBe('07388831790');client.clear();
});

it('opens additional options from a deep link and follows browser Back without losing the draft',async()=>{
 sessionStorage.clear();
 window.history.replaceState({},'','/portal?section=settings&settingsTab=website&websiteSection=legal');
 HTMLElement.prototype.scrollIntoView=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(previewSettings,{headers:{'x-settings-revision':'4'}})));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={client}><DealerSettingsPanel /></QueryClientProvider>);
 await screen.findByRole('tab',{name:'More options',selected:true});
 expect(screen.getByRole('tab',{name:'Business details',selected:true})).toBeInTheDocument();
 const company=screen.getByTestId('input-legal-company-name');
 fireEvent.change(company,{target:{value:'Example Limited'}});
 fireEvent.click(screen.getByRole('tab',{name:'Showroom'}));
 expect(screen.queryByTestId('input-legal-company-name')).not.toBeInTheDocument();
 window.history.replaceState({},'','/portal?section=settings&settingsTab=website&websiteSection=legal');
 fireEvent.popState(window);
 await screen.findByRole('tab',{name:'Business details',selected:true});
 expect(screen.getByTestId('input-legal-company-name')).toHaveValue('Example Limited');
 expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
 for(const label of ['Page wording','Services','Selling points','Printed details']){
   fireEvent.click(screen.getByRole('tab',{name:label}));
   expect(screen.getByRole('tab',{name:label,selected:true})).toBeInTheDocument();
 }
 client.clear();
});

it('names repeated opening-hours and selling-point fields so staff can distinguish each row', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(previewSettings, { headers: { 'x-settings-revision': '4' } })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DealerSettingsPanel /></QueryClientProvider>);
  const days = await screen.findByRole('textbox', { name: 'Days for opening hours row 1' });
  expect(days).toHaveValue(previewSettings.hours[0].days);
  expect(screen.getByRole('textbox', { name: 'Times for opening hours row 1' })).toHaveValue(previewSettings.hours[0].times);
  fireEvent.click(screen.getByRole('tab', { name: 'More options' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Selling points' }));
  expect(screen.getByRole('textbox', { name: 'Trust point 1' })).toHaveValue(previewSettings.trustItems[0]);
  expect(screen.getByRole('textbox', { name: 'Selling point 1 title' })).toHaveValue(previewSettings.whyBuy[0].title);
  expect(screen.getByRole('textbox', { name: 'Selling point 1 description' })).toHaveValue(previewSettings.whyBuy[0].description);
  client.clear();
});
