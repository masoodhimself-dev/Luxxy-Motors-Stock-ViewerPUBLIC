import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {HttpApiError} from '@workspace/api-client-react';
import {createSaleWorkspace,type SaleWorkspaceRecord} from '@workspace/vehicle-meta';
const state=vi.hoisted(()=>({api:vi.fn(),search:'',enquiries:[] as any[],stock:{cars:[]} as any,stockLoading:false,stockError:null as string|null}));
vi.mock('@workspace/api-client-react',()=>({customFetch:(...args:unknown[])=>state.api(...args),HttpApiError:class extends Error{},getGetStockQueryKey:()=>['/api/stock']}));
vi.mock('@/lib/enquiry-summary-query',()=>({useEnquirySummaries:()=>({data:state.enquiries,isLoading:false,isError:false})}));
vi.mock('@/lib/stock-context',()=>({useStock:()=>({stock:state.stock,isLoading:state.stockLoading,error:state.stockError})}));
vi.mock('@/lib/dealer-settings-context',()=>({useDealerSettings:()=>({settings:{identity:{name:'Fictional Motors'},contact:{},address:{},legal:{}}})}));
vi.mock('@/lib/dealer-features',()=>({useDealerFeatures:()=>({enabled:()=>true,isLoading:false,isError:false})}));
vi.mock('@/components/portal/dealer-administration',()=>({useStaffAccess:()=>({data:{permissions:['sales.manage','sales.handover']}})}));
vi.mock('@/components/portal/sale-handover',()=>({SaleHandover:()=>null,SaleHandoverFields:()=>null,handoverDefaults:()=>({})}));
vi.mock('@/components/portal/sold-vehicle-customer-review',()=>({SoldVehicleCustomerReview:()=>null}));
vi.mock('wouter',()=>({useLocation:()=>['/portal',vi.fn()],useSearch:()=>state.search}));
import {SalesWorkspace} from './sales-demo';
const branding={identity:{name:'Fictional Motors',logoText:'TEST',logoAsset:''},contact:{phone:'',email:''},address:{street:'',city:'',region:'',postcode:''},legal:{companyName:'',companyNumber:'',vatNumber:''}};
function full(id:string,name=id){return createSaleWorkspace({requestId:`create-${id}`,draft:{customer:name,email:'buyer@example.test',phone:'07700900123',address:'Private invoice address',vehicleId:'car-one',vehicle:'Ford Focus',registration:'AB12CDE',price:'6000'}},{now:'2026-10-20T10:00:00Z',actor:'Test',nextId:()=>id,nextNumber:()=>id,branding},`SALE-${id}`).sale;}
function summary(id:string,name=id){const v=full(id,name);return {id,reference:v.reference,revision:v.revision,createdAt:v.createdAt,updatedAt:v.updatedAt,draft:{customer:name,email:'buyer@example.test',phone:'07700900123',vehicleId:'car-one',vehicle:'Ford Focus',registration:'AB12CDE',sourceEnquiryId:'',sourceReservationId:''},listSummary:true,listTotalDue:600000} as unknown as SaleWorkspaceRecord;}
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={client}><SalesWorkspace embedded/></QueryClientProvider>);return {...view,refresh:()=>view.rerender(<QueryClientProvider client={client}><SalesWorkspace embedded/></QueryClientProvider>)};}
beforeEach(()=>{state.search='';state.enquiries=[];state.stock={cars:[]};state.stockLoading=false;state.stockError=null;state.api.mockReset();});
const reads=()=>state.api.mock.calls.filter(([,o])=>!o?.method).map(([p])=>p as string);
const writes=()=>state.api.mock.calls.filter(([,o])=>Boolean(o?.method));
it('loads fifty compact summaries at a time without fetching financial files',async()=>{
 const first=Array.from({length:50},(_,i)=>summary(`sale-${i}`,`Customer ${i}`));
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:first,hasMore:true}:{sales:[summary('sale-50','Older Customer')],hasMore:false});
 mount();await screen.findByRole('button',{name:/Customer 49/});
 expect(screen.getAllByText('£6,000.00')).toHaveLength(50);expect(reads()).toEqual(['/api/sale-workspace']);
 fireEvent.click(screen.getByRole('button',{name:'Load more sales'}));await screen.findByRole('button',{name:/Older Customer/});
 expect(reads()).toEqual(['/api/sale-workspace','/api/sale-workspace?offset=50']);expect(screen.queryByRole('button',{name:'Load more sales'})).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
});
it('shows the balance, handover and next action without exposing the payment ledger',async()=>{
 const reserved={...summary('deposit','Deposit Buyer'),lifecycle:{status:'reserved'},listTotalDue:600000,listPaid:50000,listPending:0,listBalance:550000,listHandover:{method:'collection',status:'Booked'}};
 const delivered={...summary('done','Completed Buyer'),completedAt:'2026-10-27T12:00:00Z',listTotalDue:600000,listPaid:600000,listPending:0,listBalance:0,listHandover:{method:'delivery',status:'Delivered'}};
 const credit={...summary('credit','Credit Buyer'),listTotalDue:600000,listPaid:650000,listPending:0,listBalance:-50000};
 state.api.mockResolvedValue({sales:[reserved,delivered,credit],hasMore:false});mount();
 const deposit=await screen.findByRole('button',{name:/Deposit Buyer/});expect(deposit).toHaveTextContent('Reserved');expect(deposit).toHaveTextContent('Balance due: £5,500.00');expect(deposit).toHaveTextContent('Collection: Booked');expect(deposit).toHaveTextContent('Next: Review the balance due');
 const complete=screen.getByRole('button',{name:/Completed Buyer/});expect(complete).toHaveTextContent('Delivery: Delivered');expect(complete).toHaveTextContent('Next: Sale completed');
 const overpaid=screen.getByRole('button',{name:/Credit Buyer/});expect(overpaid).toHaveTextContent('Customer credit: £500.00');expect(overpaid).toHaveTextContent('Next: Review customer credit');
 expect(reads()).toEqual(['/api/sale-workspace']);expect(writes()).toHaveLength(0);
});
it('does not invent a zero balance for older list responses',async()=>{
 state.api.mockResolvedValue({sales:[summary('legacy','Legacy Buyer')],hasMore:false});mount();
 const row=await screen.findByRole('button',{name:/Legacy Buyer/});expect(row).toHaveTextContent('Open sale to review the balance');expect(row).not.toHaveTextContent('Balance due:');
});
it('requires explicit confirmation before releasing a refunded reservation',async()=>{
 const saved=full('release','Refunded Buyer');saved.lifecycle={status:'reserved',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 const released={...saved,lifecycle:{...saved.lifecycle,status:'released'}};
 state.api.mockImplementation(async(p:string,o?:{method?:string})=>p==='/api/sale-workspace'?{sales:[summary('release','Refunded Buyer')],hasMore:false}:p==='/api/sale-workspace/release'&&!o?.method?{sale:saved}:p==='/api/sale-workspace/release/lifecycle'&&o?.method==='POST'?{sale:released}:Promise.reject(new Error(`Unexpected: ${p}`)));
 mount();fireEvent.click(await screen.findByRole('button',{name:/Refunded Buyer/}));await screen.findByRole('heading',{name:'Sale summary'});
 expect(writes()).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Release reservation'}));
 const dialog=screen.getByRole('dialog',{name:'Release this reservation?'});expect(dialog).toHaveTextContent('payment history will be kept');expect(dialog).toHaveTextContent('No message will be sent');expect(writes()).toHaveLength(0);
 fireEvent.click(within(dialog).getByRole('button',{name:'Release reservation'}));await screen.findByText(/Reservation released. Check the car’s published stock status/);
 expect(writes()).toHaveLength(1);expect(writes()[0][0]).toBe('/api/sale-workspace/release/lifecycle');expect(JSON.parse(writes()[0][1].body)).toMatchObject({status:'released',expectedRevision:saved.revision});
});
it('prevents releasing while confirmed or pending payments remain',async()=>{
 const saved=full('held','Held Buyer');saved.lifecycle={status:'reserved',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 saved.payments=[{id:'p1',amount:'100.00',amountPence:10000,signedAmountPence:10000,method:'Cash',date:'2026-10-27',reference:'',kind:'deposit',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'}];
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('held','Held Buyer')],hasMore:false}:{sale:saved});
 mount();fireEvent.click(await screen.findByRole('button',{name:/Held Buyer/}));await screen.findByRole('heading',{name:'Sale summary'});
 expect(screen.getByRole('button',{name:'Release reservation'})).toBeDisabled();expect(screen.getByText(/Review any received or pending payments/)).toBeVisible();expect(writes()).toHaveLength(0);
});
it('does not present the abandoned price as debt after releasing a refunded reservation',async()=>{
 const saved=full('released','Former Buyer');saved.lifecycle={status:'released',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 const row={...summary('released','Former Buyer'),lifecycle:saved.lifecycle,listTotalDue:600000,listPaid:0,listPending:0,listBalance:600000,listHandover:{method:'collection',status:'To arrange'}};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Former Buyer/});expect(listRow).toHaveTextContent('Sale not completed');expect(listRow).not.toHaveTextContent('Balance due');expect(listRow).not.toHaveTextContent('Collection: To arrange');
 fireEvent.click(listRow);const detail=await screen.findByRole('region',{name:'Saved sale summary'});expect(detail).toHaveTextContent('The reservation was released and the sale is not completed');expect(detail).toHaveTextContent('start a new invoice');expect(detail).not.toHaveTextContent('Balance due');
 for(const name of ['Record payment','Create another invoice','Prepare invoice','Edit vehicle & price','Edit customer details'])expect(within(detail).queryByRole('button',{name})).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
});
it('flags funds or pending payments on a released reservation without claiming the purchase price is due',async()=>{
 const saved=full('released-payment','Former Buyer');saved.lifecycle={status:'released',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 saved.payments=[{id:'p1',amount:'100.00',amountPence:10000,signedAmountPence:10000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'deposit',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'},{id:'p2',amount:'20.00',amountPence:2000,signedAmountPence:2000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'part-payment',status:'pending',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'}];
 const row={...summary('released-payment','Former Buyer'),lifecycle:saved.lifecycle,listTotalDue:600000,listPaid:10000,listPending:2000,listBalance:590000};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Former Buyer/});expect(listRow).toHaveTextContent('Review payment history');expect(listRow).toHaveTextContent('Net received: £100.00');expect(listRow).toHaveTextContent('Pending: £20.00');expect(listRow).not.toHaveTextContent('Balance due');
 fireEvent.click(listRow);const detail=await screen.findByRole('region',{name:'Saved sale summary'});const alert=within(detail).getByRole('alert');expect(alert).toHaveTextContent('Net received: £100.00');expect(alert).toHaveTextContent('Pending: £20.00');expect(alert).toHaveTextContent('do not mean the purchase price is due');expect(detail).toHaveTextContent('Payment history');expect(within(detail).queryByRole('button',{name:'Record payment'})).not.toBeInTheDocument();
});
it('waits for the latest full sale before allowing edits',async()=>{
 let finish!:(v:unknown)=>void;const saved=full('a','Current Customer');saved.revision=9;
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('a','Old summary')],hasMore:false}:new Promise(r=>{finish=r}));
 mount();fireEvent.click(await screen.findByRole('button',{name:/Old summary/}));await screen.findByText('Opening the complete sale…');
 expect(screen.queryByRole('heading',{name:'Sale summary'})).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
 await act(async()=>{finish({sale:saved});});expect(await screen.findByRole('heading',{name:'Sale summary'})).toBeVisible();expect(screen.getByRole('region',{name:'Saved sale summary'})).toHaveTextContent('Current Customer');expect(reads()).toContain('/api/sale-workspace/a');expect(writes()).toHaveLength(0);
});
it('debounces global search and starts a fresh result page',async()=>{
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('first','First Customer')],hasMore:false}:{sales:[summary('match','Search Customer')],hasMore:false});
 mount();await screen.findByRole('button',{name:/First Customer/});const input=screen.getByRole('textbox',{name:'Search sales'});
 fireEvent.change(input,{target:{value:'A'}});fireEvent.change(input,{target:{value:'AB'}});fireEvent.change(input,{target:{value:'AB12'}});
 await screen.findByRole('button',{name:/Search Customer/});expect(screen.queryByRole('button',{name:/First Customer/})).not.toBeInTheDocument();expect(reads()).toEqual(['/api/sale-workspace','/api/sale-workspace?q=AB12']);expect(writes()).toHaveLength(0);
});
it('ignores an earlier full-file response after selecting another sale',async()=>{
 const finish:Record<string,(v:unknown)=>void>={};state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('a','Customer A'),summary('b','Customer B')],hasMore:false}:new Promise(r=>{finish[p]=r}));
 mount();fireEvent.click(await screen.findByRole('button',{name:/Customer A/}));fireEvent.click(screen.getByRole('button',{name:/Customer B/}));
 await act(async()=>{finish['/api/sale-workspace/b']({sale:full('b','Correct B')});});await screen.findByRole('heading',{name:'Sale summary'});
 await act(async()=>{finish['/api/sale-workspace/a']({sale:full('a','Stale A')});});expect(screen.queryByText('Stale A')).not.toBeInTheDocument();expect(screen.getByRole('region',{name:'Saved sale summary'})).toHaveTextContent('Correct B');expect(writes()).toHaveLength(0);
});
it('loads an exact historical sale URL beyond the first list page',async()=>{
 state.search='?section=sales&saleId=old-sale';state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:{sale:full('old-sale','Historical Buyer')});
 mount();expect(await screen.findByRole('heading',{name:'Sale summary'})).toBeVisible();expect(screen.getByRole('region',{name:'Saved sale summary'})).toHaveTextContent('Historical Buyer');expect(reads()).toContain('/api/sale-workspace/old-sale');expect(writes()).toHaveLength(0);
});
it('finds the existing source-enquiry sale before considering a new one',async()=>{
 state.search='?section=sales&enquiryId=old-enquiry';const row=summary('old-sale','Existing Buyer'),saved=full('old-sale','Existing Buyer');row.draft.sourceEnquiryId=saved.draft.sourceEnquiryId='old-enquiry';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p.includes('?enquiryId=')?{sales:[row],hasMore:false}:{sale:saved});
 mount();expect(await screen.findByRole('heading',{name:'Sale summary'})).toBeVisible();expect(reads()).toContain('/api/sale-workspace?enquiryId=old-enquiry');expect(writes()).toHaveLength(0);
});
it('starts a new enquiry-linked sale after every previous sale is safely released',async()=>{
 state.search='?section=sales&enquiryId=old-enquiry';state.enquiries=[{id:'old-enquiry',customerName:'Returning Buyer',vehicleId:'car-one',vehicleTitle:'Ford Focus'}];state.stock={cars:[{id:'car-one',title:'Ford Focus',price:6000}]};
 const old={...summary('released','Returning Buyer'),lifecycle:{status:'released'},listPaid:0,listPending:0,listLedgerKnown:true};old.draft.sourceEnquiryId='old-enquiry';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p.includes('?enquiryId=')?{sales:[old],hasMore:false}:Promise.reject(new Error(`Unexpected: ${p}`)));
 mount();expect(await screen.findByRole('heading',{name:'Which car are you selling?'})).toBeVisible();expect(screen.getByLabelText('Vehicle')).toHaveValue('car-one');expect(reads()).not.toContain('/api/sale-workspace/released');expect(writes()).toHaveLength(0);
});
it('checks later enquiry pages and opens an active sale before reusing a released one',async()=>{
 state.search='?section=sales&enquiryId=old-enquiry';state.enquiries=[{id:'old-enquiry',customerName:'Returning Buyer',vehicleId:'car-one'}];
 const old={...summary('released','Returning Buyer'),lifecycle:{status:'released'},listPaid:0,listPending:0,listLedgerKnown:true};old.draft.sourceEnquiryId='old-enquiry';
 const active=summary('active','Active Buyer'),saved=full('active','Active Buyer');active.draft.sourceEnquiryId=saved.draft.sourceEnquiryId='old-enquiry';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p==='/api/sale-workspace?enquiryId=old-enquiry'?{sales:[old],hasMore:true}:p==='/api/sale-workspace?enquiryId=old-enquiry&offset=1'?{sales:[active],hasMore:false}:p==='/api/sale-workspace/active'?{sale:saved}:Promise.reject(new Error(`Unexpected: ${p}`)));
 mount();expect(await screen.findByRole('heading',{name:'Sale summary'})).toBeVisible();expect(screen.getByRole('region',{name:'Saved sale summary'})).toHaveTextContent('Active Buyer');expect(reads()).toContain('/api/sale-workspace?enquiryId=old-enquiry&offset=1');expect(writes()).toHaveLength(0);
});
it.each([{listPaid:10000,listPending:0,listLedgerKnown:true},{listPaid:0,listPending:1000,listLedgerKnown:true},{listPaid:0,listPending:0,listLedgerKnown:false},{}])('opens a released sale with unsettled or unknown payments instead of starting another: %s',async amounts=>{
 state.search='?section=sales&enquiryId=old-enquiry';const old={...summary('released','Prior Buyer'),lifecycle:{status:'released'},...amounts};old.draft.sourceEnquiryId='old-enquiry';const saved=full('released','Prior Buyer');saved.draft.sourceEnquiryId='old-enquiry';saved.lifecycle={status:'released',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p.includes('?enquiryId=')?{sales:[old],hasMore:false}:p==='/api/sale-workspace/released'?{sale:saved}:Promise.reject(new Error(`Unexpected: ${p}`)));
 mount();expect(await screen.findByRole('heading',{name:'Sale summary'})).toBeVisible();expect(screen.getByRole('region',{name:'Saved sale summary'})).toHaveTextContent('Prior Buyer');expect(writes()).toHaveLength(0);
});
it('stops if another page of enquiry-linked sales cannot be checked',async()=>{
 state.search='?section=sales&enquiryId=old-enquiry';state.enquiries=[{id:'old-enquiry',customerName:'Returning Buyer',vehicleId:'car-one'}];const old={...summary('released','Returning Buyer'),lifecycle:{status:'released'},listPaid:0,listPending:0,listLedgerKnown:true};old.draft.sourceEnquiryId='old-enquiry';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p==='/api/sale-workspace?enquiryId=old-enquiry'?{sales:[old],hasMore:true}:Promise.reject(new Error('Page unavailable')));
 mount();expect(await screen.findByRole('alert')).toHaveTextContent('The linked sale could not be checked');expect(screen.queryByRole('heading',{name:'Which car are you selling?'})).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
});

it('keeps a full-file response from replacing a new invoice started while it was loading',async()=>{
 let finish!:(v:unknown)=>void;state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('old','Previous Buyer')],hasMore:false}:new Promise(r=>{finish=r}));
 mount();fireEvent.click(await screen.findByRole('button',{name:/Previous Buyer/}));fireEvent.click(screen.getByRole('button',{name:'New invoice'}));
 expect(screen.getByRole('heading',{name:'Which car are you selling?'})).toBeVisible();
 await act(async()=>{finish({sale:full('old','Wrong Previous Buyer')});});
 expect(screen.getByRole('heading',{name:'Which car are you selling?'})).toBeVisible();expect(screen.queryByText(/Wrong Previous Buyer/)).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
});
it('looks up an older returning customer using compact search without reading their old sale file',async()=>{
 const current=full('current',''),older=summary('older','Returning Buyer');older.draft.vehicleId='another-car';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('current','Current draft')],hasMore:false}:p==='/api/sale-workspace/current'?{sale:current}:p==='/api/sale-workspace?q=Returning+Buyer'?{sales:[older],hasMore:false}:{sales:[],hasMore:false});
 mount();fireEvent.click(await screen.findByRole('button',{name:/Current draft/}));await screen.findByRole('heading',{name:'Sale summary'});
 fireEvent.click(screen.getByRole('button',{name:'Add customer details'}));
 const name=screen.getByLabelText('Customer’s full name');fireEvent.focus(name);fireEvent.change(name,{target:{value:'Returning Buyer'}});
 const option=await screen.findByRole('option',{name:/Returning Buyer/});fireEvent.click(option);
 expect(screen.getByLabelText('Telephone')).toHaveValue('07700900123');expect(screen.getByLabelText('Customer address')).toHaveValue('');
 expect(reads()).toContain('/api/sale-workspace?q=Returning+Buyer');expect(reads()).not.toContain('/api/sale-workspace/older');expect(writes()).toHaveLength(0);
});

it('waits for slow stock before prefilling a new enquiry-linked sale and keeps the loaded price and title',async()=>{
 state.search='?section=sales&enquiryId=new-enquiry';state.stock=null;state.stockLoading=true;
 state.enquiries=[{id:'new-enquiry',customerName:'Linked Buyer',email:'linked@example.test',phone:'07700900123',vehicleId:'car-one',vehicleTitle:'Earlier title',vehicleRegistration:'AB12CDE'}];
 state.api.mockResolvedValue({sales:[],hasMore:false});const view=mount();
 expect(await screen.findByText('Opening the complete sale…')).toBeVisible();
 expect(screen.queryByRole('heading',{name:'Which car are you selling?'})).not.toBeInTheDocument();
 expect(reads()).not.toContain('/api/sale-workspace?enquiryId=new-enquiry');
 state.stock={cars:[{id:'car-one',make:'Ford',model:'Focus',title:'Ford Focus',price:6789,registration:'AB12CDE',inventoryStatus:'available'}]};state.stockLoading=false;view.refresh();
 expect(await screen.findByRole('heading',{name:'Which car are you selling?'})).toBeVisible();
 expect(screen.getByLabelText('Vehicle')).toHaveValue('car-one');
 expect(screen.getByLabelText('Agreed vehicle price (£)')).toHaveValue('6789');
 expect(screen.getByText('Ford Focus')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Continue/}));
 expect(await screen.findByLabelText('Customer’s full name')).toHaveValue('Linked Buyer');expect(writes()).toHaveLength(0);
});
it('keeps a manual invoice started while linked stock is loading',async()=>{
 state.search='?section=sales&enquiryId=new-enquiry';state.stock=null;state.stockLoading=true;
 state.enquiries=[{id:'new-enquiry',customerName:'Linked Buyer',vehicleId:'car-one',vehicleTitle:'Ford Focus'}];
 state.api.mockResolvedValue({sales:[],hasMore:false});const view=mount();await screen.findByText('Opening the complete sale…');
 fireEvent.click(screen.getByRole('button',{name:'New invoice'}));fireEvent.change(screen.getByLabelText('Agreed vehicle price (£)'),{target:{value:'4321'}});
 state.stock={cars:[{id:'car-one',title:'Ford Focus',price:6789,inventoryStatus:'available'}]};state.stockLoading=false;view.refresh();
 expect(screen.getByLabelText('Agreed vehicle price (£)')).toHaveValue('4321');
 expect(reads()).not.toContain('/api/sale-workspace?enquiryId=new-enquiry');expect(writes()).toHaveLength(0);
});
it('settled stock errors retain linked enquiry identity and allow manual price entry',async()=>{
 state.search='?section=sales&enquiryId=new-enquiry';state.stock=null;state.stockLoading=false;state.stockError='Temporary stock failure';
 state.enquiries=[{id:'new-enquiry',customerName:'Linked Buyer',email:'linked@example.test',phone:'07700900123',vehicleId:'car-one',vehicleTitle:'Ford Focus',vehicleRegistration:'AB12CDE'}];
 state.api.mockResolvedValue({sales:[],hasMore:false});mount();
 expect(await screen.findByRole('heading',{name:'Which car are you selling?'})).toBeVisible();
 expect(screen.getByRole('alert')).toHaveTextContent('Current stock could not be loaded');
 expect(screen.getByLabelText('Vehicle')).toHaveValue('car-one');expect(screen.getByLabelText('Registration / number plate')).toHaveValue('AB12CDE');
 fireEvent.change(screen.getByLabelText('Agreed vehicle price (£)'),{target:{value:'6000'}});fireEvent.click(screen.getByRole('button',{name:/Continue/}));
 expect(await screen.findByLabelText('Customer’s full name')).toHaveValue('Linked Buyer');expect(writes()).toHaveLength(0);
});

it('isolates a test sale from real stock and customers and removes only its session',async()=>{
 const session={sessionId:'synthetic-session',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'test-car',title:'[TEST] Example Car',registration:'TEST 01',price:1000},customer:{name:'[TEST] Example Buyer',phone:'07700900123',email:'',address:'1 Example Road, Test Town, TE1 1ST'}};
 const base='/api/sales-test/sessions/synthetic-session';
 state.stock={cars:[{id:'real-car',title:'Real Stock Car',price:9999}]};
 state.enquiries=[{id:'real-customer',customerName:'Private Customer',vehicleId:'real-car'}];
 state.api.mockImplementation(async(p:string,o?:{method?:string;body?:string})=>{
  if(p==='/api/sale-workspace')return {sales:[summary('real-sale','Private Buyer')],hasMore:false};
  if(p==='/api/sales-test/sessions'&&!o?.method)return {session:null};
  if(p==='/api/sales-test/sessions'&&o?.method==='POST')return session;
  if(p===`${base}/stock`)return {cars:[session.vehicle]};
  if(p===`${base}/sale-workspace`&&!o?.method)return {sales:[],hasMore:false};
  if(p===`${base}/sale-workspace`&&o?.method==='POST'){
   const payload=JSON.parse(o.body!);
   return createSaleWorkspace(payload,{now:'2026-10-27T10:00:00Z',actor:'Test',nextId:()=> 'test-sale',nextNumber:()=> 'TEST-01',branding},'TEST-01');
  }
  if(p===base&&o?.method==='DELETE')return {cleared:true};
  throw new Error(`Unexpected request: ${p}`);
 });
 mount();await screen.findByRole('button',{name:/Private Buyer/});fireEvent.click(screen.getByRole('button',{name:'Start test sale'}));
 await screen.findByText('TEST MODE — fictional sale');
 await waitFor(()=>expect(screen.queryByRole('button',{name:/Private Buyer/})).not.toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'New invoice'}));
 expect(await screen.findByRole('heading',{name:'Which car are you selling?'})).toBeVisible();
 expect(await screen.findByRole('option',{name:/\[TEST\] Example Car/})).toBeInTheDocument();
 expect(screen.queryByRole('option',{name:/Real Stock Car/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Continue/}));
 expect(screen.getByLabelText('Customer’s full name')).toHaveValue('[TEST] Example Buyer');
 expect(screen.getByText('TEST 01')).toBeVisible();
 expect(screen.queryByText('Registration not added')).not.toBeInTheDocument();
 expect(screen.getByLabelText('Customer address')).toHaveValue('1 Example Road, Test Town, TE1 1ST');
 expect(screen.queryByText('Private Customer')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Save details'}));
 await waitFor(()=>expect(writes().some(([p])=>p===`${base}/sale-workspace`)).toBe(true));
 const create=writes().find(([p])=>p===`${base}/sale-workspace`);
 expect(JSON.parse(create![1].body).draft.customer).toBe('[TEST] Example Buyer');
 expect(JSON.parse(create![1].body).draft.vehicleId).toBe('test-car');
 expect(writes().some(([p])=>p==='/api/sale-workspace')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'End test and delete test data'}));
 expect(screen.getByRole('dialog',{name:'End this test?'})).toBeVisible();
 fireEvent.click(within(screen.getByRole('dialog',{name:'End this test?'})).getByRole('button',{name:'Clear test data'}));
 await waitFor(()=>expect(writes().some(([p,o])=>p===base&&o?.method==='DELETE')).toBe(true));
 expect(await screen.findByRole('button',{name:/Private Buyer/})).toBeInTheDocument();
});

it('recovers an expired test only for cleanup and allows retry after a cleanup failure',async()=>{
 const session={sessionId:'expired-session',expiresAt:'2001-01-01T00:00:00Z',vehicle:{id:'test-car',title:'[TEST] Example Car',registration:'TEST 01',price:1000},customer:{name:'[TEST] Example Buyer',phone:'07700900123',email:'',address:'1 Example Road, Test Town, TE1 1ST'}};
 let attempts=0;
 state.api.mockImplementation(async(p:string,o?:{method?:string})=>{
  if(p==='/api/sale-workspace')return {sales:[],hasMore:false};
  if(p==='/api/sales-test/sessions'&&!o?.method)return {session};
  if(p==='/api/sales-test/sessions/expired-session'&&o?.method==='DELETE'){if(++attempts===1)throw new Error('Cleanup temporarily unavailable');return {cleared:true};}
  throw new Error(`Unexpected request: ${p}`);
 });
 mount();await screen.findByRole('button',{name:'Start test sale'});fireEvent.click(screen.getByRole('button',{name:'Start test sale'}));
 expect(await screen.findByText('TEST MODE — session expired')).toBeVisible();
 expect(screen.queryByRole('button',{name:'New invoice'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'End test and delete test data'}));
 let dialog=screen.getByRole('dialog',{name:'End this test?'});fireEvent.click(within(dialog).getByRole('button',{name:'Clear test data'}));
 await within(dialog).findByText('Cleanup temporarily unavailable');
 expect(screen.getByText('TEST MODE — session expired')).toBeVisible();
 fireEvent.click(within(dialog).getByRole('button',{name:'Clear test data'}));
 await screen.findByRole('button',{name:'Start test sale'});
 expect(attempts).toBe(2);
 expect(writes().filter(([p])=>p==='/api/sales-test/sessions')).toHaveLength(0);
 expect(writes().filter(([p])=>p==='/api/sale-workspace')).toHaveLength(0);
});

it('does not create a session if checking for an existing one fails',async()=>{
 state.api.mockImplementation(async(p:string)=>{
  if(p==='/api/sale-workspace')return {sales:[],hasMore:false};
  if(p==='/api/sales-test/sessions')throw new Error('Session check failed');
  throw new Error(`Unexpected request: ${p}`);
 });
 mount();await screen.findByRole('button',{name:'Start test sale'});fireEvent.click(screen.getByRole('button',{name:'Start test sale'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Session check failed');
 expect(writes()).toHaveLength(0);
});

it.each(['absent','newer'] as const)('recovers a lost cleanup response when the original session is %s', async (outcome) => {
 const session={sessionId:'old-session',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'test-car',title:'[TEST] Example Car',registration:'TEST 01',price:1000},customer:{name:'[TEST] Example Buyer',phone:'07700900123',email:'',address:'1 Example Road, Test Town, TE1 1ST'}};
 let reads=0;
 state.api.mockImplementation(async(p:string,o?:{method?:string})=>{
  if(p==='/api/sale-workspace')return {sales:[],hasMore:false};
  if(p==='/api/sales-test/sessions'&&!o?.method)return {session:++reads===1?session:outcome==='absent'?null:{...session,sessionId:'newer-session'}};
  if(p==='/api/sales-test/sessions/old-session'&&o?.method==='DELETE')throw Object.assign(Object.create(HttpApiError.prototype),{message:'Not found',status:404});
  if(p==='/api/sales-test/sessions/old-session/stock')return {cars:[session.vehicle]};
  if(p==='/api/sales-test/sessions/old-session/sale-workspace')return {sales:[],hasMore:false};
  throw new Error(`Unexpected request: ${p}`);
 });
 mount();await screen.findByRole('button',{name:'Start test sale'});fireEvent.click(screen.getByRole('button',{name:'Start test sale'}));
 await screen.findByText('TEST MODE — fictional sale');fireEvent.click(screen.getByRole('button',{name:'End test and delete test data'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'End this test?'})).getByRole('button',{name:'Clear test data'}));
 await screen.findByRole('button',{name:'Start test sale'});
 expect(reads).toBe(2);
 expect(writes().filter(([p,o])=>o?.method==='DELETE').map(([p])=>p)).toEqual(['/api/sales-test/sessions/old-session']);
 expect(writes().some(([p])=>p==='/api/sales-test/sessions/newer-session')).toBe(false);
});

it.each(['still-present','malformed','unavailable'] as const)('keeps the test open if cleanup cannot be verified: %s', async (outcome) => {
 const session={sessionId:'old-session',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'test-car',title:'[TEST] Example Car',registration:'TEST 01',price:1000},customer:{name:'[TEST] Example Buyer',phone:'07700900123',email:'',address:'1 Example Road, Test Town, TE1 1ST'}};
 let reads=0;
 state.api.mockImplementation(async(p:string,o?:{method?:string})=>{
  if(p==='/api/sale-workspace')return {sales:[],hasMore:false};
  if(p==='/api/sales-test/sessions'&&!o?.method){
   if(++reads===1)return {session};
   if(outcome==='unavailable')throw new Error('Check unavailable');
   return outcome==='malformed'?{}:{session};
  }
  if(p==='/api/sales-test/sessions/old-session'&&o?.method==='DELETE')throw Object.assign(Object.create(HttpApiError.prototype),{message:'Not found',status:404});
  if(p==='/api/sales-test/sessions/old-session/stock')return {cars:[session.vehicle]};
  if(p==='/api/sales-test/sessions/old-session/sale-workspace')return {sales:[],hasMore:false};
  throw new Error(`Unexpected request: ${p}`);
 });
 mount();await screen.findByRole('button',{name:'Start test sale'});fireEvent.click(screen.getByRole('button',{name:'Start test sale'}));
 await screen.findByText('TEST MODE — fictional sale');fireEvent.click(screen.getByRole('button',{name:'End test and delete test data'}));
 const dialog=screen.getByRole('dialog',{name:'End this test?'});fireEvent.click(within(dialog).getByRole('button',{name:'Clear test data'}));
 expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not found');
 expect(screen.getByText('TEST MODE — fictional sale')).toBeVisible();
 expect(reads).toBe(2);
});

it.each(['refund','note'])('does not claim the calculated balance is owed after a completed sale has a %s',async kind=>{
 const saved=full('completed-corrected','Corrected Buyer');saved.completedAt='2026-10-27T10:00:00Z';
 saved.payments=[{id:'p1',amount:'6000.00',amountPence:600000,signedAmountPence:600000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'part-payment',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'}];
 if(kind==='refund')saved.payments.push({id:'p2',amount:'500.00',amountPence:50000,signedAmountPence:-50000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'refund',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'});
 else saved.corrections=[{id:'note',description:'Accountant reviewing price correction',reference:'ACC-5',recordedAt:'2026-10-27T10:10:00Z',recordedBy:'Staff'}];
 const row={...summary('completed-corrected','Corrected Buyer'),completedAt:saved.completedAt,listTotalDue:600000,listPaid:kind==='refund'?550000:600000,listPending:0,listBalance:kind==='refund'?50000:0,listHasRefunds:kind==='refund',listHasCorrectionNotes:kind==='note'};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:p==='/api/sale-workspace/paperwork'?{correctionSettings:{handling:'accountant',instructions:''}}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Corrected Buyer/});expect(listRow).toHaveTextContent('Review correction with accountant');expect(listRow).toHaveTextContent('Calculated balance (review)');expect(listRow).not.toHaveTextContent('Balance due');
 fireEvent.click(listRow);const detail=await screen.findByRole('region',{name:'Saved sale summary'});expect(detail).toHaveTextContent('Calculated balance (review)');expect(detail).not.toHaveTextContent('Balance due');expect(detail).toHaveTextContent('does not include external price corrections');expect(detail).toHaveTextContent('before treating it as money owed');
 fireEvent.click(within(detail).getByRole('button',{name:'Review payment history'}));expect(screen.getByText('Calculated balance (review)')).toBeVisible();expect(screen.queryByText('Balance due')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('before treating it as money owed');expect(writes()).toHaveLength(0);
});

it('flags an externally corrected deposit invoice even before a sale is completed',async()=>{
 const saved=full('deposit-note','Deposit Buyer');saved.corrections=[{id:'note',description:'Price correction is being reviewed',reference:'ACC-1',recordedAt:'2026-10-27T10:10:00Z',recordedBy:'Staff'}];
 const row={...summary('deposit-note','Deposit Buyer'),listTotalDue:600000,listPaid:100000,listPending:0,listBalance:500000,listHasCorrectionNotes:true};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Deposit Buyer/});expect(listRow).toHaveTextContent('Review correction with accountant');expect(listRow).toHaveTextContent('Calculated balance (review): £5,000.00');expect(listRow).not.toHaveTextContent('Balance due');
 fireEvent.click(listRow);const detail=await screen.findByRole('region',{name:'Saved sale summary'});expect(detail).toHaveTextContent('does not include external price corrections');expect(detail).toHaveTextContent('Calculated balance (review)');expect(detail).not.toHaveTextContent('Balance due');expect(writes()).toHaveLength(0);
});

it('flags an external correction on a released reservation without displaying a balance due',async()=>{
 const saved=full('released-note','Released Buyer');saved.lifecycle={status:'released',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};saved.corrections=[{id:'note',description:'Reference filed with accountant',reference:'ACC-1',recordedAt:'2026-10-27T10:10:00Z',recordedBy:'Staff'}];
 const row={...summary('released-note','Released Buyer'),lifecycle:saved.lifecycle,listTotalDue:600000,listPaid:0,listPending:0,listBalance:600000,listHasCorrectionNotes:true};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Released Buyer/});expect(listRow).toHaveTextContent('Review correction with accountant');expect(listRow).not.toHaveTextContent('Balance due');
 fireEvent.click(listRow);const detail=await screen.findByRole('region',{name:'Saved sale summary'});expect(detail).toHaveTextContent('This released sale has a correction note');expect(detail).not.toHaveTextContent('Balance due');expect(writes()).toHaveLength(0);
});
