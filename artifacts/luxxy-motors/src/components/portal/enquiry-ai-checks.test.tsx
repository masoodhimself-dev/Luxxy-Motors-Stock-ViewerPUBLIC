import { beforeEach,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const state=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({customFetch:(...args:unknown[])=>state.fetch(...args)}));
vi.mock('./portal-ui',()=>({formatDateTime:(date:string)=>date}));
import {EnquiryAiChecks} from './enquiry-ai-checks';
const show=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryAiChecks id="case-one"/></QueryClientProvider>);
const open=()=>{const element=screen.getByText('What AI checked').closest('details')!;element.open=true;fireEvent(element,new Event('toggle'));};
beforeEach(()=>{state.fetch.mockReset();});
it('loads private evidence only when requested and clearly shows an unavailable MOT check',async()=>{
  state.fetch.mockResolvedValue({model:'gpt-6-luna',createdAt:'2026-11-03',contextAudit:{checkedAt:'2026-11-03',questions:[{topic:'registration',outcome:'verified',source:'Current dealer stock'},{topic:'mot',outcome:'unavailable',source:'DVSA MOT history'}],lookups:[{kind:'mot',status:'unavailable',errorCode:'not_found'}]}});
  show();expect(state.fetch).not.toHaveBeenCalled();open();
  await waitFor(()=>expect(screen.getByText('Could not verify')).toBeVisible());
  expect(screen.getByText('Registration')).toBeVisible();expect(screen.getByText(/Check the record before confirming/)).toBeVisible();
  expect(screen.queryByText('not_found')).not.toBeInTheDocument();
});
it('does not invent an audit for an older draft',async()=>{
  state.fetch.mockRejectedValue({status:404});show();open();
  await waitFor(()=>expect(screen.getByText(/No check history was saved/)).toBeVisible());
  expect(screen.queryByText('Verified')).not.toBeInTheDocument();
});
