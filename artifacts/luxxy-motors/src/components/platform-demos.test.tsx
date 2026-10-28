import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { afterEach,it,expect,vi } from 'vitest';
import { PlatformDemos } from './platform-demos';
afterEach(()=>vi.unstubAllGlobals());
it('shows missing infrastructure and keeps creation disabled',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({domain:'',emailDomain:'',recipients:[],configured:false,emailReady:false})));render(<PlatformDemos onCreated={()=>{}}/>);await screen.findByText('One-time platform setup required');expect(screen.getByRole('button',{name:'Create demo dealership'})).toBeDisabled();});
it('creates a demo using only operator-approved destinations and does not invent a worker connection',async()=>{const created=vi.fn(),requests:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_path,init)=>{if(init?.method==='POST'){requests.push(JSON.parse(String(init.body)));return Response.json({dealerId:'demo-example'});}return Response.json({domain:'demo.example.test',emailDomain:'mail.example.test',recipients:['operator@example.test'],configured:true,emailReady:false});}));render(<PlatformDemos onCreated={created}/>);await screen.findByLabelText('Demo dealership name');fireEvent.change(screen.getByLabelText('Demo dealership name'),{target:{value:'Example Motors'}});fireEvent.change(screen.getByLabelText('Demo retailer reference'),{target:{value:'fictional'}});fireEvent.change(screen.getByLabelText('Authorised demo stock source URL'),{target:{value:'https://www.autotrader.co.uk/fictional'}});fireEvent.click(screen.getByRole('button',{name:'Create demo dealership'}));await waitFor(()=>expect(created).toHaveBeenCalledWith('demo-example'));expect(requests[0]).toMatchObject({slug:'example-motors',recipient:'operator@example.test',days:14});expect(screen.getByText(/Grok collection and scheduling remain separate/)).toBeInTheDocument();});
it('has no fictional activity or reset controls and confirms a demo extension',async()=>{const writes:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_path,init)=>{if(init?.method==='POST'){writes.push(JSON.parse(String(init.body)));return Response.json({status:'ready'});}return Response.json({demo:true,revision:4,recipient:'operator@example.test',expiresAt:'2026-11-01'});}));render(<PlatformDemos dealerId="demo-example" onCreated={()=>{}}/>);const extend=await screen.findByRole('button',{name:'Extend for 14 days'});expect(extend).toBeDisabled();for(const name of ['Restore original demo','Reset demo activity','Save starting point','Replace starting point'])expect(screen.queryByRole('button',{name})).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('Type demo-example to confirm changes'),{target:{value:'demo-example'}});fireEvent.click(extend);await screen.findByText('Demo extended for 14 days.');expect(writes).toEqual([{action:'extend',expectedRevision:4,confirm:'demo-example',days:14}]);});
it('does not offer destructive actions for a live dealership',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({demo:false})));render(<PlatformDemos dealerId="live-dealer" onCreated={()=>{}}/>);await screen.findByText('This is a regular dealership.');expect(screen.queryByRole('button',{name:'Restore original demo'})).not.toBeInTheDocument();});
it('updates a demo inbox only after confirmation using an approved destination',async()=>{const writes:any[]=[];vi.stubGlobal('fetch',vi.fn(async(path,init)=>{if(init?.method==='POST'){writes.push(JSON.parse(String(init.body)));return Response.json({status:'ready'});}return Response.json(String(path).endsWith('/demo-config')?{recipients:['new@example.test']}:{demo:true,revision:5,recipient:'old@example.test',expiresAt:'2026-11-01',baselineSaved:true});}));render(<PlatformDemos dealerId="demo-example" onCreated={()=>{}}/>);await screen.findByRole('option',{name:'new@example.test'});const update=screen.getByRole('button',{name:'Update demo inbox'});fireEvent.change(screen.getByLabelText('Approved demo email inbox'),{target:{value:'new@example.test'}});expect(update).toBeDisabled();fireEvent.change(screen.getByLabelText('Type demo-example to confirm changes'),{target:{value:'demo-example'}});fireEvent.click(update);await screen.findByText('Demo email recipient updated.');expect(writes).toEqual([{action:'recipient',expectedRevision:5,confirm:'demo-example',recipient:'new@example.test'}]);});

const conversionReady={
 demo:true,converted:false,revision:9,ready:true,
 domainOrigin:'https://dealer.example.test' as string|null,eligibleOrigins:['https://dealer.example.test'],blockedReasons:[] as string[],
 checks:[{id:'domain',label:'Live domain',ready:true,detail:'Ownership and HTTPS confirmed.'}],
};
function conversionMock(readiness=conversionReady,writeResult?:()=>Response) {
 const writes:{path:string;body:unknown}[]=[];
 const fetcher=vi.fn(async(path:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='POST') {
   writes.push({path:String(path),body:JSON.parse(String(init.body))});
   return writeResult?.()??Response.json({status:'converted',dealerId:'demo-example',origin:'https://dealer.example.test',notice:'Converted successfully. Fictional activity removed.'});
  }
  if(String(path).includes('/conversion'))return Response.json({...readiness,domainOrigin:new URL(String(path),'https://platform.example.test').searchParams.get('origin')??readiness.domainOrigin});
  if(String(path).endsWith('/demo-config'))return Response.json({recipients:['operator@example.test']});
  return Response.json({demo:true,revision:4,recipient:'operator@example.test',expiresAt:'2026-11-01',baselineSaved:true});
 });
 vi.stubGlobal('fetch',fetcher);
 return {writes,fetcher};
}

it('checks conversion readiness only when the operator opens its review',async()=>{
 const {fetcher}=conversionMock();
 render(<PlatformDemos dealerId="demo-example" onCreated={()=>{}}/>);
 const review=await screen.findByRole('button',{name:'Review live conversion'});
 expect(fetcher.mock.calls.some(([path])=>String(path).endsWith('/conversion'))).toBe(false);
 fireEvent.click(review);
 await screen.findByText('Ownership and HTTPS confirmed.');
 expect(screen.getByLabelText('Live website domain')).toHaveValue('https://dealer.example.test');
 expect(screen.getByRole('button',{name:'Convert to live dealership'})).toBeDisabled();
 expect(screen.getByText(/This action does not pause or create a Grok schedule/)).toBeInTheDocument();
});

it('shows conversion blockers and prevents confirmation until all checks pass',async()=>{
 const {writes}=conversionMock({...conversionReady,ready:false,domainOrigin:null,eligibleOrigins:[],blockedReasons:['Verify a real dealership domain.'],checks:[{id:'domain',label:'Live domain',ready:false,detail:'A demo subdomain cannot be the live website.'}]});
 render(<PlatformDemos dealerId="demo-example" onCreated={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review live conversion'}));
 await screen.findByText('Verify a real dealership domain.');
 expect(screen.getByLabelText('Type demo-example to convert to live')).toBeDisabled();
 expect(screen.getByRole('checkbox',{name:/I have stopped practice activity/})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Convert to live dealership'}));
 expect(writes).toEqual([]);
});

it('rechecks the selected verified live domain and clears any previous confirmation',async()=>{
 const {fetcher}=conversionMock({...conversionReady,eligibleOrigins:['https://dealer.example.test','https://www.dealer.example.test']});
 render(<PlatformDemos dealerId="demo-example" onCreated={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review live conversion'}));
 fireEvent.change(await screen.findByLabelText('Type demo-example to convert to live'),{target:{value:'demo-example'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/I have stopped practice activity/}));
 fireEvent.change(screen.getByLabelText('Live website domain'),{target:{value:'https://www.dealer.example.test'}});
 await waitFor(()=>expect(screen.getByLabelText('Live website domain')).toHaveValue('https://www.dealer.example.test'));
 expect(fetcher.mock.calls.some(([path])=>String(path)==='/api/platform/dealers/demo-example/conversion?origin=https%3A%2F%2Fwww.dealer.example.test')).toBe(true);
 expect(screen.getByLabelText('Type demo-example to convert to live')).toHaveValue('');
 expect(screen.getByRole('checkbox',{name:/I have stopped practice activity/})).not.toBeChecked();
 expect(screen.getByRole('button',{name:'Convert to live dealership'})).toBeDisabled();
});

it('requires the exact dealer ID and cleanup acknowledgement, then refreshes the live dealership',async()=>{
 const {writes}=conversionMock(),onCreated=vi.fn();
 render(<PlatformDemos dealerId="demo-example" onCreated={onCreated}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review live conversion'}));
 const confirm=await screen.findByLabelText('Type demo-example to convert to live');
 const convert=screen.getByRole('button',{name:'Convert to live dealership'});
 fireEvent.change(confirm,{target:{value:'demo-example'}});
 expect(convert).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox',{name:/I have stopped practice activity/}));
 fireEvent.change(confirm,{target:{value:'demo-example '}});
 expect(convert).toBeDisabled();
 fireEvent.change(confirm,{target:{value:'demo-example'}});
 expect(convert).toBeEnabled();
 fireEvent.click(convert);
 await screen.findByText('Converted successfully. Fictional activity removed.');
 expect(writes).toEqual([{path:'/api/platform/dealers/demo-example/conversion',body:{expectedRevision:9,domainOrigin:'https://dealer.example.test',confirm:'demo-example',acknowledge:true}}]);
 expect(onCreated).toHaveBeenCalledWith('demo-example');
 expect(screen.queryByRole('button',{name:'Restore original demo'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Review live conversion'})).not.toBeInTheDocument();
});

it('requires a new readiness check after a conversion error instead of repeating a stale submission',async()=>{
 const {writes}=conversionMock(conversionReady,()=>Response.json({error:'Dealership changed. Refresh checks.'},{status:409}));
 render(<PlatformDemos dealerId="demo-example" onCreated={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review live conversion'}));
 fireEvent.change(await screen.findByLabelText('Type demo-example to convert to live'),{target:{value:'demo-example'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/I have stopped practice activity/}));
 fireEvent.click(screen.getByRole('button',{name:'Convert to live dealership'}));
 await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:'Convert to live dealership'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Refresh checks'}));
 const confirm=await screen.findByLabelText('Type demo-example to convert to live');
 expect(confirm).toHaveValue('');
 expect(screen.getByRole('checkbox',{name:/I have stopped practice activity/})).not.toBeChecked();
 expect(writes).toHaveLength(1);
});

it('does not expose conversion or request its checks for a regular dealership',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({demo:false}));
 vi.stubGlobal('fetch',fetcher);
 render(<PlatformDemos dealerId="live-dealer" onCreated={()=>{}}/>);
 await screen.findByText('This is a regular dealership.');
 expect(screen.queryByRole('button',{name:'Review live conversion'})).not.toBeInTheDocument();
 expect(fetcher.mock.calls.some(([path])=>String(path).endsWith('/conversion'))).toBe(false);
});
