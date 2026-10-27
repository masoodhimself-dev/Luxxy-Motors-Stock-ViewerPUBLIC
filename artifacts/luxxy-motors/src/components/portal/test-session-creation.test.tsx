import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { beforeEach,expect,it,vi } from 'vitest';
import { customFetch } from '@workspace/api-client-react';
import { StartTestDialog,usePortalTestSession } from './test-session';
vi.mock('@workspace/api-client-react',async original=>({...await original<object>(),customFetch:vi.fn()}));
beforeEach(()=>{sessionStorage.clear();vi.mocked(customFetch).mockReset();});
it('can begin with a test customer when the dealership has no customers',async()=>{
  vi.mocked(customFetch).mockImplementation(async url=>String(url).endsWith('available-vehicles')?{cars:[{id:'car',title:'Car',registration:'',price:1}]} as never:{customers:[]} as never);
  const start=vi.fn().mockResolvedValue(true);
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><StartTestDialog open onOpenChange={()=>{}} onStart={start} busy={false} error="" scope="dealer" /></QueryClientProvider>);
  await screen.findByRole('option',{name:'Car'});
  fireEvent.change(screen.getByLabelText('Car'),{target:{value:'car'}});
  fireEvent.change(screen.getByLabelText('Customer'),{target:{value:'test:new'}});
  expect(screen.getByRole('button',{name:'Start test'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Test customer name'),{target:{value:'Practice Buyer'}});
  fireEvent.click(screen.getByRole('button',{name:'Start test'}));
  await waitFor(()=>expect(start).toHaveBeenCalledWith('car','new','test',{name:'Practice Buyer',phone:'',email:''}));
});
const example={sessionId:'old-session',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'test-car',title:'Car',registration:'',price:1},customer:{name:'Customer',email:'',phone:'',address:''}};
function Harness(){const test=usePortalTestSession('dealer:user',true);return <><p>{test.failed?'failed':test.checking?'checking':test.locked?'locked':test.session?.sessionId??'live'}</p><button onClick={()=>void test.end()}>End</button><button onClick={()=>void test.retry()}>Retry</button></>;}
function mountHarness(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Harness /></QueryClientProvider>);}
it('does not offer live controls when the session check fails',async()=>{
  vi.mocked(customFetch).mockRejectedValue(new Error('Unable to check session'));
  mountHarness();await screen.findByText('failed');expect(screen.queryByText('live')).not.toBeInTheDocument();
});
it.each(['same','newer','malformed','unavailable'] as const)('keeps test mode protected when cleanup cannot be verified: %s',async result=>{
  let reads=0;vi.spyOn(window,'confirm').mockReturnValue(true);
  vi.mocked(customFetch).mockImplementation(async (url,options)=>{
    if(options?.method==='DELETE')throw new Error('Cleanup unavailable');
    if(String(url)==='/api/sales-test/sessions'){
      if(++reads===1)return {session:example} as never;
      if(result==='unavailable')throw new Error('Session check unavailable');
      return (result==='malformed'?{}:{session:result==='newer'?{...example,sessionId:'newer-session'}:example}) as never;
    }
    throw Error('Unexpected request');
  });
  mountHarness();await screen.findByText('old-session');fireEvent.click(screen.getByRole('button',{name:'End'}));
  await waitFor(()=>expect(reads).toBe(2));
  if(result==='newer')await screen.findByText('newer-session');else if(result==='same')await screen.findByText('old-session');else await screen.findByText('failed');
  expect(screen.queryByText('live')).not.toBeInTheDocument();
  expect(vi.mocked(customFetch).mock.calls.filter(([,options])=>options?.method==='DELETE').map(([url])=>url)).toEqual(['/api/sales-test/sessions/old-session']);
});
it('accepts explicit absence after a lost cleanup response',async()=>{
  let reads=0;vi.spyOn(window,'confirm').mockReturnValue(true);
  vi.mocked(customFetch).mockImplementation(async(_url,options)=>{if(options?.method==='DELETE')throw new Error('Response lost');return {session:++reads===1?example:null} as never;});
  mountHarness();await screen.findByText('old-session');fireEvent.click(screen.getByRole('button',{name:'End'}));await screen.findByText('live');
});
it('clears only this test shortlist after confirmed cleanup',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true);
  window.sessionStorage.setItem('luxxy.test-customer-shortlist.v1:old-session','test data');
  window.sessionStorage.setItem('luxxy.test-customer-snapshots.v1:old-session','test snapshots');
  window.sessionStorage.setItem('luxxy.test-customer-shortlist.v1:another-session','other data');
  window.localStorage.setItem('luxxy.saved-cars.v1','["real-car"]');
  vi.mocked(customFetch).mockImplementation(async(_url,options)=>options?.method==='DELETE'?{cleared:true} as never:{session:example} as never);
  mountHarness();await screen.findByText('old-session');fireEvent.click(screen.getByRole('button',{name:'End'}));await screen.findByText('live');
  expect(window.sessionStorage.getItem('luxxy.test-customer-shortlist.v1:old-session')).toBeNull();
  expect(window.sessionStorage.getItem('luxxy.test-customer-snapshots.v1:old-session')).toBeNull();
  expect(window.sessionStorage.getItem('luxxy.test-customer-shortlist.v1:another-session')).toBe('other data');
  expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["real-car"]');
});
