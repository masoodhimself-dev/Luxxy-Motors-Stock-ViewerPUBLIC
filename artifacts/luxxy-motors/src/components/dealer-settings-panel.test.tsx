import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DealerSettingsPanel } from './dealer-settings-panel';
import { previewSettings } from '../../preview/settings';
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({stock:{cars:[]}}) }));
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
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
  const name = await screen.findByTestId('input-identity-name');
  fireEvent.change(name,{target:{value:'Fictional Test Motors'}});
  fireEvent.click(screen.getByTestId('button-settings-nav-contact'));
  fireEvent.click(screen.getByTestId('button-settings-nav-identity'));
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
  fireEvent.change(await screen.findByTestId('input-identity-name'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'Review changes'}));
  await waitFor(()=>expect(screen.getByTestId('settings-error-summary')).toHaveTextContent('Add the dealership name.'));
  expect(writes).toHaveLength(0);client.clear();
});
