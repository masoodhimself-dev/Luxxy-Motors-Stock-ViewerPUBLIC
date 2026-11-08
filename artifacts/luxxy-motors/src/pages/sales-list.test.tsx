import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {changeSaleWorkspace,createSaleWorkspace,type SaleWorkspaceRecord} from '@workspace/vehicle-meta';
const state=vi.hoisted(()=>({permissions:['sales.manage','sales.handover','payments.record'],api:vi.fn(),navigate:vi.fn(),search:'',enquiries:[] as any[],stock:{cars:[]} as any,stockLoading:false,stockError:null as string|null}));
vi.mock('@workspace/api-client-react',()=>({customFetch: (...args: unknown[]) => {
    const url = String(args[0]);
    if (url === '/api/sales-terms') return Promise.resolve({ published: null });
    if (url.startsWith('/api/sales-terms/sales/')) return Promise.resolve({ documents: [] });
    if (url.includes('/delivery-evidence')) return Promise.resolve({ jobs: [] });
    return state.api(...args);
  },HttpApiError:class extends Error{},getGetStockQueryKey:()=>['/api/stock']}));
vi.mock('@/lib/enquiry-summary-query',()=>({useEnquirySummaries:()=>({data:state.enquiries,isLoading:false,isError:false})}));
vi.mock('@/lib/stock-context',()=>({useStock:()=>({stock:state.stock,isLoading:state.stockLoading,error:state.stockError})}));
vi.mock('@/lib/dealer-settings-context',()=>({useDealerSettings:()=>({settings:{identity:{name:'Fictional Motors'},contact:{},address:{},legal:{}}})}));
vi.mock('@/lib/dealer-features',()=>({useDealerFeatures:()=>({enabled:()=>true,isLoading:false,isError:false})}));
vi.mock('@/components/portal/dealer-administration',()=>({useStaffAccess:()=>({data:{permissions:state.permissions}})}));
vi.mock('@/components/portal/sale-handover',()=>({SaleHandover:()=>null,SaleHandoverFields:()=>null,handoverDefaults:()=>({})}));
vi.mock('@/components/portal/sold-vehicle-customer-review',()=>({SoldVehicleCustomerReview:()=>null}));
vi.mock('wouter',()=>({useLocation:()=>['/portal',state.navigate],useSearch:()=>state.search}));
import {SalesWorkspace} from './sales-demo';
const branding={identity:{name:'Fictional Motors',logoText:'TEST',logoAsset:''},contact:{phone:'',email:''},address:{street:'',city:'',region:'',postcode:''},legal:{companyName:'',companyNumber:'',vatNumber:''}};
function full(id:string,name=id){return createSaleWorkspace({requestId:`create-${id}`,draft:{customer:name,email:'buyer@example.test',phone:'07700900123',address:'Private invoice address',vehicleId:'car-one',vehicle:'Ford Focus',registration:'AB12CDE',price:'6000'}},{now:'2026-10-20T10:00:00Z',actor:'Test',nextId:()=>id,nextNumber:()=>id,branding},`SALE-${id}`).sale;}
function summary(id:string,name=id){const v=full(id,name);return {id,reference:v.reference,revision:v.revision,createdAt:v.createdAt,updatedAt:v.updatedAt,draft:{customer:name,email:'buyer@example.test',phone:'07700900123',vehicleId:'car-one',vehicle:'Ford Focus',registration:'AB12CDE',sourceEnquiryId:'',sourceReservationId:''},listSummary:true,listTotalDue:600000} as unknown as SaleWorkspaceRecord;}
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={client}><SalesWorkspace embedded/></QueryClientProvider>);return {...view,refresh:()=>view.rerender(<QueryClientProvider client={client}><SalesWorkspace embedded/></QueryClientProvider>)};}
beforeEach(()=>{state.permissions=['sales.manage','sales.handover','payments.record'];state.search='';state.enquiries=[];state.stock={cars:[]};state.stockLoading=false;state.stockError=null;state.api.mockReset();state.navigate.mockReset();});

function navigateSection(section:string){
 if(section==='Deal'){fireEvent.click(screen.getByRole('button',{name:'Car'}));return;}
 const title=section==='Payments'?'Take a payment':section==='Invoices'?'Create an invoice':'Arrange collection or delivery';
 if(!screen.queryByRole('button',{name:new RegExp(`^${title}`)})){const back=screen.queryAllByRole('button',{name:'All actions'});if(back.length)fireEvent.click(back[0]);else fireEvent.click(screen.getAllByRole('button',{name:'Choose what to do'}).find(button=>!button.hasAttribute('disabled'))!);}
 const target=screen.getByRole('button',{name:new RegExp(`^${title}`)});
 fireEvent.click(section==='Payments'&&target.hasAttribute('disabled')?screen.getByRole('button',{name:'Payments and documents'}):target);
}
async function openCarScreen(){return await screen.findByRole('heading',{name:/Choose a car|Choose the customer|Review sale details|What would you like to do\?/});}
function vehicleSelection(){fireEvent.click(screen.getByRole('button',{name:'Car'}));return screen.getByRole('region',{name:'Vehicle selection'});}

const reads=()=>state.api.mock.calls.filter(([,o])=>!o?.method).map(([p])=>p as string);
const writes=()=>state.api.mock.calls.filter(([,o])=>Boolean(o?.method));
it('loads fifty compact summaries at a time without fetching financial files',async()=>{
 const first=Array.from({length:50},(_,i)=>summary(`sale-${i}`,`Customer ${i}`));
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:first,hasMore:true}:{sales:[summary('sale-50','Older Customer')],hasMore:false});
 mount();await screen.findByRole('button',{name:/Customer 49/});
 expect(screen.getAllByText('Sale total £6,000.00')).toHaveLength(50);expect(reads()).toEqual(['/api/sale-workspace']);
 fireEvent.click(screen.getByRole('button',{name:'Load more sales'}));await screen.findByRole('button',{name:/Older Customer/});
 expect(reads()).toEqual(['/api/sale-workspace','/api/sale-workspace?offset=50']);expect(screen.queryByRole('button',{name:'Load more sales'})).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
});
it('shows the balance, handover and next action without exposing the payment ledger',async()=>{
 const reserved={...summary('deposit','Deposit Buyer'),lifecycle:{status:'reserved'},listTotalDue:600000,listPaid:50000,listPending:0,listBalance:550000,listHandover:{method:'collection',status:'Booked'}};
 const delivered={...summary('done','Completed Buyer'),completedAt:'2026-10-27T12:00:00Z',listTotalDue:600000,listPaid:600000,listPending:0,listBalance:0,listHandover:{method:'delivery',status:'Delivered'}};
 const credit={...summary('credit','Credit Buyer'),listTotalDue:600000,listPaid:650000,listPending:0,listBalance:-50000};
 state.api.mockResolvedValue({sales:[reserved,delivered,credit],hasMore:false});mount();
 const deposit=await screen.findByRole('button',{name:/Deposit Buyer/});expect(deposit).toHaveTextContent('Reserved');expect(deposit).toHaveTextContent('Balance due: £5,500.00');expect(deposit).toHaveTextContent('Collection: Booked');expect(within(deposit.closest('article')!).getByRole('button',{name:'Review balance'})).toBeVisible();
 const complete=screen.getByRole('button',{name:/Completed Buyer/});expect(complete).toHaveTextContent('Delivered');expect(complete).toHaveTextContent('Paid in full');expect(within(complete.closest('article')!).getByRole('button',{name:'View sale documents'})).toBeVisible();
 const overpaid=screen.getByRole('button',{name:/Credit Buyer/});expect(overpaid).toHaveTextContent('Customer credit: £500.00');expect(within(overpaid.closest('article')!).getByRole('button',{name:'Review customer credit'})).toBeVisible();
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
 mount();fireEvent.click(await screen.findByRole('button',{name:/Refunded Buyer/}));await openCarScreen();
 fireEvent.click(screen.getByRole('button',{name:'Car'}));fireEvent.click(screen.getByText('Sale actions'));expect(writes()).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Release reservation'}));
 const dialog=screen.getByRole('dialog',{name:'Release this reservation?'});expect(dialog).toHaveTextContent('payment history will be kept');expect(dialog).toHaveTextContent('No message will be sent');expect(writes()).toHaveLength(0);
 fireEvent.click(within(dialog).getByRole('button',{name:'Release reservation'}));await screen.findByText(/Reservation released. Check the car’s published stock status/);
 expect(writes()).toHaveLength(1);expect(writes()[0][0]).toBe('/api/sale-workspace/release/lifecycle');expect(JSON.parse(writes()[0][1].body)).toMatchObject({status:'released',expectedRevision:saved.revision});
});
it('prevents releasing while confirmed or pending payments remain',async()=>{
 const saved=full('held','Held Buyer');saved.lifecycle={status:'reserved',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 saved.payments=[{id:'p1',amount:'100.00',amountPence:10000,signedAmountPence:10000,method:'Cash',date:'2026-10-27',reference:'',kind:'deposit',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'}];
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('held','Held Buyer')],hasMore:false}:{sale:saved});
 mount();fireEvent.click(await screen.findByRole('button',{name:/Held Buyer/}));await openCarScreen();
 fireEvent.click(screen.getByRole('button',{name:'Car'}));fireEvent.click(screen.getByText('Sale actions'));expect(screen.getByRole('button',{name:'Release reservation'})).toBeDisabled();expect(screen.getByText(/received and pending payments are clear/)).toBeVisible();expect(writes()).toHaveLength(0);
});
it('does not present the abandoned price as debt after releasing a refunded reservation',async()=>{
 const saved=full('released','Former Buyer');saved.lifecycle={status:'released',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 const row={...summary('released','Former Buyer'),lifecycle:saved.lifecycle,listTotalDue:600000,listPaid:0,listPending:0,listBalance:600000,listHandover:{method:'collection',status:'To arrange'}};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Former Buyer/});expect(listRow).toHaveTextContent('Sale not completed');expect(listRow).not.toHaveTextContent('Balance due');expect(listRow).not.toHaveTextContent('Collection: To arrange');
 fireEvent.click(listRow);const detail=(await openCarScreen()).closest('.sale-desk') as HTMLElement;expect(detail).toHaveTextContent('This reservation was released');expect(detail).toHaveTextContent('Start a new sale');expect(detail).not.toHaveTextContent('Balance due');
 for(const name of ['Record payment','Create another invoice','Prepare invoice','Edit vehicle & price'])expect(within(detail).queryByRole('button',{name})).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
});
it('flags funds or pending payments on a released reservation without claiming the purchase price is due',async()=>{
 const saved=full('released-payment','Former Buyer');saved.lifecycle={status:'released',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 saved.payments=[{id:'p1',amount:'100.00',amountPence:10000,signedAmountPence:10000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'deposit',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'},{id:'p2',amount:'20.00',amountPence:2000,signedAmountPence:2000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'part-payment',status:'pending',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'}];
 const row={...summary('released-payment','Former Buyer'),lifecycle:saved.lifecycle,listTotalDue:600000,listPaid:10000,listPending:2000,listBalance:590000};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Former Buyer/});expect(listRow).toHaveTextContent('Review payment history');expect(listRow).toHaveTextContent('Net received: £100.00');expect(listRow).toHaveTextContent('Pending: £20.00');expect(listRow).not.toHaveTextContent('Balance due');
 fireEvent.click(listRow);const detail=(await openCarScreen()).closest('.sale-desk') as HTMLElement;const alert=within(detail).getByRole('alert');expect(alert).toHaveTextContent('Net received: £100.00');expect(alert).toHaveTextContent('Pending: £20.00');expect(alert).toHaveTextContent('do not mean the purchase price is due');navigateSection('Payments');expect(screen.getByRole('heading',{name:'Money received'})).toBeVisible();expect(within(detail).queryByRole('button',{name:'Record payment'})).not.toBeInTheDocument();
});
it('waits for the latest full sale before allowing edits',async()=>{
 let finish!:(v:unknown)=>void;const saved=full('a','Current Customer');saved.revision=9;
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('a','Old summary')],hasMore:false}:new Promise(r=>{finish=r}));
 mount();fireEvent.click(await screen.findByRole('button',{name:/Old summary/}));await screen.findByText('Opening the complete sale…');
 expect(screen.queryByRole('heading',{name:'Choose a car'})).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
 await act(async()=>{finish({sale:saved});});expect(await openCarScreen()).toBeVisible();expect(document.body).toHaveTextContent('Current Customer');expect(reads()).toContain('/api/sale-workspace/a');expect(writes()).toHaveLength(0);
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
 await act(async()=>{finish['/api/sale-workspace/b']({sale:full('b','Correct B')});});await openCarScreen();
 await act(async()=>{finish['/api/sale-workspace/a']({sale:full('a','Stale A')});});expect(screen.queryByText('Stale A')).not.toBeInTheDocument();expect(document.body).toHaveTextContent('Correct B');expect(writes()).toHaveLength(0);
});
it('loads an exact historical sale URL beyond the first list page',async()=>{
 state.search='?section=sales&saleId=old-sale';state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:{sale:full('old-sale','Historical Buyer')});
 mount();expect(await openCarScreen()).toBeVisible();expect(document.body).toHaveTextContent('Historical Buyer');expect(reads()).toContain('/api/sale-workspace/old-sale');expect(writes()).toHaveLength(0);
});
it('finds the existing source-enquiry sale before considering a new one',async()=>{
 state.search='?section=sales&enquiryId=old-enquiry';const row=summary('old-sale','Existing Buyer'),saved=full('old-sale','Existing Buyer');row.draft.sourceEnquiryId=saved.draft.sourceEnquiryId='old-enquiry';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p.includes('?enquiryId=')?{sales:[row],hasMore:false}:{sale:saved});
 mount();expect(await openCarScreen()).toBeVisible();expect(reads()).toContain('/api/sale-workspace?enquiryId=old-enquiry');expect(writes()).toHaveLength(0);
});
it('starts a new enquiry-linked sale after every previous sale is safely released',async()=>{
 state.search='?section=sales&enquiryId=old-enquiry';state.enquiries=[{id:'old-enquiry',customerName:'Returning Buyer',vehicleId:'car-one',vehicleTitle:'Ford Focus'}];state.stock={cars:[{id:'car-one',title:'Ford Focus',price:6000}]};
 const old={...summary('released','Returning Buyer'),lifecycle:{status:'released'},listPaid:0,listPending:0,listLedgerKnown:true};old.draft.sourceEnquiryId='old-enquiry';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p.includes('?enquiryId=')?{sales:[old],hasMore:false}:Promise.reject(new Error(`Unexpected: ${p}`)));
 mount();expect(await openCarScreen()).toBeVisible();expect(within(vehicleSelection()).getByRole('status')).toHaveTextContent('Ford Focus selected');fireEvent.click(screen.getByRole('button',{name:'Change vehicle'}));expect(screen.getByRole('button',{name:'Choose Ford Focus'})).toHaveAttribute('aria-pressed','true');expect(reads()).not.toContain('/api/sale-workspace/released');expect(writes()).toHaveLength(0);
});
it('checks later enquiry pages and opens an active sale before reusing a released one',async()=>{
 state.search='?section=sales&enquiryId=old-enquiry';state.enquiries=[{id:'old-enquiry',customerName:'Returning Buyer',vehicleId:'car-one'}];
 const old={...summary('released','Returning Buyer'),lifecycle:{status:'released'},listPaid:0,listPending:0,listLedgerKnown:true};old.draft.sourceEnquiryId='old-enquiry';
 const active=summary('active','Active Buyer'),saved=full('active','Active Buyer');active.draft.sourceEnquiryId=saved.draft.sourceEnquiryId='old-enquiry';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p==='/api/sale-workspace?enquiryId=old-enquiry'?{sales:[old],hasMore:true}:p==='/api/sale-workspace?enquiryId=old-enquiry&offset=1'?{sales:[active],hasMore:false}:p==='/api/sale-workspace/active'?{sale:saved}:Promise.reject(new Error(`Unexpected: ${p}`)));
 mount();expect(await openCarScreen()).toBeVisible();expect(document.body).toHaveTextContent('Active Buyer');expect(reads()).toContain('/api/sale-workspace?enquiryId=old-enquiry&offset=1');expect(writes()).toHaveLength(0);
});
it.each([{listPaid:10000,listPending:0,listLedgerKnown:true},{listPaid:0,listPending:1000,listLedgerKnown:true},{listPaid:0,listPending:0,listLedgerKnown:false},{}])('opens a released sale with unsettled or unknown payments instead of starting another: %s',async amounts=>{
 state.search='?section=sales&enquiryId=old-enquiry';const old={...summary('released','Prior Buyer'),lifecycle:{status:'released'},...amounts};old.draft.sourceEnquiryId='old-enquiry';const saved=full('released','Prior Buyer');saved.draft.sourceEnquiryId='old-enquiry';saved.lifecycle={status:'released',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p.includes('?enquiryId=')?{sales:[old],hasMore:false}:p==='/api/sale-workspace/released'?{sale:saved}:Promise.reject(new Error(`Unexpected: ${p}`)));
 mount();expect(await openCarScreen()).toBeVisible();expect(document.body).toHaveTextContent('Prior Buyer');expect(writes()).toHaveLength(0);
});
it('stops if another page of enquiry-linked sales cannot be checked',async()=>{
 state.search='?section=sales&enquiryId=old-enquiry';state.enquiries=[{id:'old-enquiry',customerName:'Returning Buyer',vehicleId:'car-one'}];const old={...summary('released','Returning Buyer'),lifecycle:{status:'released'},listPaid:0,listPending:0,listLedgerKnown:true};old.draft.sourceEnquiryId='old-enquiry';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:p==='/api/sale-workspace?enquiryId=old-enquiry'?{sales:[old],hasMore:true}:Promise.reject(new Error('Page unavailable')));
 mount();expect(await screen.findByRole('alert')).toHaveTextContent('The linked sale could not be checked');expect(screen.queryByRole('heading',{name:'Choose a car'})).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
});

it('keeps a full-file response from replacing a new invoice started while it was loading',async()=>{
 let finish!:(v:unknown)=>void;state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('old','Previous Buyer')],hasMore:false}:new Promise(r=>{finish=r}));
 mount();fireEvent.click(await screen.findByRole('button',{name:/Previous Buyer/}));fireEvent.click(screen.getByRole('button',{name:'New sale'}));
 expect(screen.getByRole('heading',{name:'Choose a car'})).toBeVisible();
 await act(async()=>{finish({sale:full('old','Wrong Previous Buyer')});});
 expect(screen.getByRole('heading',{name:'Choose a car'})).toBeVisible();expect(screen.queryByText(/Wrong Previous Buyer/)).not.toBeInTheDocument();expect(writes()).toHaveLength(0);
});
it('looks up an older returning customer using compact search without reading their old sale file',async()=>{
 const current=full('current',''),older=summary('older','Returning Buyer');older.draft.vehicleId='another-car';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('current','Current draft')],hasMore:false}:p==='/api/sale-workspace/current'?{sale:current}:p==='/api/sale-workspace?q=Returning+Buyer'?{sales:[older],hasMore:false}:{sales:[],hasMore:false});
 mount();fireEvent.click(await screen.findByRole('button',{name:/Current draft/}));await openCarScreen();
 fireEvent.click(screen.getByRole('button',{name:'Customer'}));
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
 expect(screen.queryByRole('heading',{name:'Choose a car'})).not.toBeInTheDocument();
 expect(reads()).not.toContain('/api/sale-workspace?enquiryId=new-enquiry');
 state.stock={cars:[{id:'car-one',make:'Ford',model:'Focus',title:'Ford Focus',price:6789,registration:'AB12CDE',inventoryStatus:'available'}]};state.stockLoading=false;view.refresh();
 expect(await screen.findByRole('heading',{name:'Review sale details'})).toBeVisible();
 expect(screen.getByText('Ford Focus')).toBeVisible();
 expect(screen.getByLabelText('Agreed vehicle price (£)')).toHaveValue('6789');
 expect(screen.getByLabelText('Customer’s full name')).toHaveValue('Linked Buyer');
 expect(screen.getByLabelText('Email for the invoice')).toHaveValue('linked@example.test');
 expect(screen.getByRole('button',{name:'Confirm details and open sale'})).toBeEnabled();
 expect(writes()).toHaveLength(0);
});
it('keeps a manual invoice started while linked stock is loading',async()=>{
 state.search='?section=sales&enquiryId=new-enquiry';state.stock=null;state.stockLoading=true;
 state.enquiries=[{id:'new-enquiry',customerName:'Linked Buyer',vehicleId:'car-one',vehicleTitle:'Ford Focus'}];
 state.api.mockResolvedValue({sales:[],hasMore:false});const view=mount();await screen.findByText('Opening the complete sale…');
 fireEvent.click(screen.getByRole('button',{name:'New sale'}));fireEvent.change(screen.getByLabelText('Agreed vehicle price (£)'),{target:{value:'4321'}});
 state.stock={cars:[{id:'car-one',title:'Ford Focus',price:6789,inventoryStatus:'available'}]};state.stockLoading=false;view.refresh();
 expect(screen.getByLabelText('Agreed vehicle price (£)')).toHaveValue('4321');
 expect(reads()).not.toContain('/api/sale-workspace?enquiryId=new-enquiry');expect(writes()).toHaveLength(0);
});
it('settled stock errors retain linked enquiry identity and allow manual price entry',async()=>{
 state.search='?section=sales&enquiryId=new-enquiry';state.stock=null;state.stockLoading=false;state.stockError='Temporary stock failure';
 state.enquiries=[{id:'new-enquiry',customerName:'Linked Buyer',email:'linked@example.test',phone:'07700900123',vehicleId:'car-one',vehicleTitle:'Ford Focus',vehicleRegistration:'AB12CDE'}];
 state.api.mockResolvedValue({sales:[],hasMore:false});mount();
 expect(await openCarScreen()).toBeVisible();
 expect(screen.getByRole('alert')).toHaveTextContent('Current stock could not be loaded');
 expect(within(vehicleSelection()).getByRole('status')).toHaveTextContent('Ford Focus selected · saved vehicle details kept');expect(screen.getByLabelText('Registration / number plate')).toHaveValue('AB12CDE');
 fireEvent.change(screen.getByLabelText('Agreed vehicle price (£)'),{target:{value:'6000'}});fireEvent.click(screen.getByRole('button',{name:'Choose customer'}));
 expect(await screen.findByLabelText('Customer’s full name')).toHaveValue('Linked Buyer');expect(writes()).toHaveLength(0);
});



it.each(['refund','note'])('does not claim the calculated balance is owed after a completed sale has a %s',async kind=>{
 const saved=full('completed-corrected','Corrected Buyer');saved.completedAt='2026-10-27T10:00:00Z';
 saved.payments=[{id:'p1',amount:'6000.00',amountPence:600000,signedAmountPence:600000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'part-payment',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'}];
 if(kind==='refund')saved.payments.push({id:'p2',amount:'500.00',amountPence:50000,signedAmountPence:-50000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'refund',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'});
 else saved.corrections=[{id:'note',description:'Accountant reviewing price correction',reference:'ACC-5',recordedAt:'2026-10-27T10:10:00Z',recordedBy:'Staff'}];
 const row={...summary('completed-corrected','Corrected Buyer'),completedAt:saved.completedAt,listTotalDue:600000,listPaid:kind==='refund'?550000:600000,listPending:0,listBalance:kind==='refund'?50000:0,listHasRefunds:kind==='refund',listHasCorrectionNotes:kind==='note'};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:p==='/api/sale-workspace/paperwork'?{correctionSettings:{handling:'accountant',instructions:''}}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Corrected Buyer/});expect(listRow).toHaveTextContent('Review correction with accountant');expect(listRow).toHaveTextContent('Calculated balance (review)');expect(listRow).not.toHaveTextContent('Balance due');
 fireEvent.click(listRow);const detail=(await openCarScreen()).closest('.sale-desk') as HTMLElement;expect(detail).toHaveTextContent('Balance to review');expect(detail).not.toHaveTextContent('Balance due');expect(detail).toHaveTextContent('refunds or external corrections');expect(detail).toHaveTextContent('before relying on the calculated balance');
 navigateSection('Payments');expect(screen.getAllByText('Balance to review').some(element=>element.closest('.sale-desk'))).toBe(true);expect(screen.queryByText('Balance due')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('before relying on the calculated balance');expect(writes()).toHaveLength(0);
});

it('flags an externally corrected deposit invoice even before a sale is completed',async()=>{
 const saved=full('deposit-note','Deposit Buyer');saved.corrections=[{id:'note',description:'Price correction is being reviewed',reference:'ACC-1',recordedAt:'2026-10-27T10:10:00Z',recordedBy:'Staff'}];
 const row={...summary('deposit-note','Deposit Buyer'),listTotalDue:600000,listPaid:100000,listPending:0,listBalance:500000,listHasCorrectionNotes:true};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Deposit Buyer/});expect(listRow).toHaveTextContent('Review correction with accountant');expect(listRow).toHaveTextContent('Calculated balance (review): £5,000.00');expect(listRow).not.toHaveTextContent('Balance due');
 fireEvent.click(listRow);const detail=(await openCarScreen()).closest('.sale-desk') as HTMLElement;expect(detail).toHaveTextContent('refunds or external corrections');expect(detail).toHaveTextContent('Balance to review');expect(detail).not.toHaveTextContent('Balance due');expect(writes()).toHaveLength(0);
});

it('flags an external correction on a released reservation without displaying a balance due',async()=>{
 const saved=full('released-note','Released Buyer');saved.lifecycle={status:'released',vehicleId:'car-one',changedAt:'2026-10-27T10:00:00Z'};saved.corrections=[{id:'note',description:'Reference filed with accountant',reference:'ACC-1',recordedAt:'2026-10-27T10:10:00Z',recordedBy:'Staff'}];
 const row={...summary('released-note','Released Buyer'),lifecycle:saved.lifecycle,listTotalDue:600000,listPaid:0,listPending:0,listBalance:600000,listHasCorrectionNotes:true};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[row],hasMore:false}:{sale:saved});mount();
 const listRow=await screen.findByRole('button',{name:/Released Buyer/});expect(listRow).toHaveTextContent('Review correction with accountant');expect(listRow).not.toHaveTextContent('Balance due');
 fireEvent.click(listRow);const detail=(await openCarScreen()).closest('.sale-desk') as HTMLElement;expect(detail).toHaveTextContent('refunds or external corrections');expect(detail).not.toHaveTextContent('Balance due');expect(writes()).toHaveLength(0);
});

it('keeps Accounts payment and invoice access on existing sales without offering new sales or detail edits',async()=>{
 state.permissions=['payments.record','payments.refund'];
 const sale=full('accounts','Existing Buyer');
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('accounts','Existing Buyer')],hasMore:false}:{sale});
 mount();fireEvent.click(await screen.findByRole('button',{name:/Existing Buyer/}));
 await openCarScreen();
 expect(screen.queryByRole('button',{name:'New sale'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Customer'}));
 expect(screen.getByRole('combobox',{name:'Customer’s full name'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Save details'})).not.toBeInTheDocument();
 fireEvent.click(screen.getAllByRole('button',{name:'Choose what to do'}).find(button=>!button.closest('nav'))!);
 await screen.findByRole('button',{name:/^Take a payment/});
 navigateSection('Payments');expect(screen.getByLabelText('Payment amount (£)')).toBeEnabled();
 navigateSection('Invoices');expect(screen.getByRole('button',{name:'Sales invoice'})).toBeEnabled();
 expect(writes()).toHaveLength(0);
});

it('uses the server queue and owner filter together before opening the matching next action', async () => {
 const saved=full('pending-queue','Pending buyer');
 saved.payments=[{id:'pending',amount:'100.00',amountPence:10000,signedAmountPence:10000,method:'Bank transfer',date:'2026-10-27',reference:'',kind:'deposit',status:'pending',recordedBy:'Staff',recordedAt:'2026-10-27T10:00:00Z'}];
 const row={...summary(saved.id,'Pending buyer'),listOwnerName:'Alex',listHasTeamNote:true,listAttention:'Payment to confirm'};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary('other','Other buyer')]}:p.includes('queue=attention')?{sales:[row]}:{sale:saved});
 mount();await screen.findByRole('button',{name:/Other buyer/});
 const filters=screen.getByRole('button',{name:'Filters'});
 expect(filters).toHaveAttribute('aria-expanded','false');
 fireEvent.click(filters);
 expect(filters).toHaveAttribute('aria-expanded','true');
 fireEvent.click(screen.getByRole('button',{name:'Needs attention'}));
 const pending=await screen.findByRole('button',{name:/Pending buyer/});
 expect(pending).toHaveTextContent('Alex · Staff note');
 expect(pending).toHaveTextContent('Payment to confirm');
 fireEvent.change(screen.getByRole('combobox',{name:'Sale owner'}),{target:{value:'mine'}});
 await screen.findByRole('button',{name:/Pending buyer/});
 expect(reads()).toContain('/api/sale-workspace?queue=attention&owner=mine');
 expect(filters).toHaveAccessibleName('Filters (2)');
 fireEvent.click(filters);
 expect(filters).toHaveAttribute('aria-expanded','false');
 fireEvent.click(screen.getByRole('button',{name:'Review pending payment'}));
 await screen.findByRole('heading',{name:'Payments and documents'});
 expect(reads()).toContain('/api/sale-workspace/pending-queue');
 expect(writes()).toHaveLength(0);
});

it('opens an exact next-action URL without changing sale or stock', async () => {
 const saved=full('linked-queue','Linked buyer');
 state.search='?section=sales&saleId=linked-queue&saleAction=next';
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[],hasMore:false}:{sale:saved});
 mount();
 await screen.findByRole('heading',{name:'Request a deposit'});
 expect(reads()).toContain('/api/sale-workspace/linked-queue');
 expect(writes()).toHaveLength(0);
});

it('loads the staff directory on demand and saves the handover note as staff details', async () => {
 const saved=full('owner-test','Buyer with owner');
 const team={ownerId:'alice',ownerName:'Alice',note:'Call before collection.',updatedAt:saved.updatedAt,updatedBy:'Staff'};
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary(saved.id,'Buyer with owner')]}:
   p==='/api/staff/directory'?{currentUserId:'alice',members:[{id:'alice',name:'Alice'}]}:
   p.endsWith('/team')?{sale:{...saved,revision:saved.revision+1,team}}:{sale:saved});
 mount();fireEvent.click(await screen.findByRole('button',{name:/Buyer with owner/}));
 await screen.findByRole('heading',{name:'What would you like to do?'});
 expect(reads()).not.toContain('/api/staff/directory');
 fireEvent.click(screen.getByText('Sale owner'));
 await screen.findByRole('option',{name:'Alice (you)'});
 fireEvent.change(screen.getByRole('combobox',{name:'Assigned to'}),{target:{value:'alice'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Staff handover note'}),{target:{value:'Call before collection.'}});
 expect(screen.getByText('Unsaved staff details')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Save staff details'}));
 expect(await screen.findByText('Staff details saved.')).toBeVisible();
 expect(screen.getByText('Alice · Staff note')).toBeVisible();
 expect(writes()).toHaveLength(1);
 expect(writes()[0][0]).toBe('/api/sale-workspace/owner-test/team');
 expect(JSON.parse(writes()[0][1].body)).toMatchObject({ ownerId:'alice',note:'Call before collection.',expectedRevision:saved.revision });
});


it('opens the balance shortcut in payment history without pre-opening a payment form', async () => {
 const saved=full('balance-test','Balance buyer');
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[{...summary(saved.id,'Balance buyer'),listBalance:500000,listLedgerKnown:true}]}:{sale:saved});
 mount();
 fireEvent.click(await screen.findByRole('button',{name:'Review balance'}));
 await screen.findByRole('heading',{name:'Payments and documents'});
 expect(screen.queryByLabelText('Payment amount (£)')).not.toBeInTheDocument();
 expect(writes()).toHaveLength(0);
});

it('opens an already issued invoice without starting a new invoice or changing stock', async () => {
 const original=full('invoice-queue','Invoice buyer');
 const sale=changeSaleWorkspace(original,{action:'document',type:'invoice'},{expectedRevision:original.revision,requestId:'issue-queue-test'},{now:original.updatedAt,actor:'Test',nextId:()=> 'invoice-queue-document',nextNumber:()=> 'INV-QUEUE',branding}).sale;
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[{...summary(sale.id,'Invoice buyer'),listStage:'Invoice ready',listHasInvoice:true,listAttention:'Invoice to review'}]}:{sale});
 mount();
 fireEvent.click(await screen.findByRole('button',{name:'View invoice'}));
 await screen.findByText('INV-QUEUE',{exact:false});
 expect(writes()).toHaveLength(0);
});


it('can reopen an exact sale attention link after returning to the queue', async () => {
 const linked='?section=sales&saleId=attention-link&saleAction=payments';
 const saved=full('attention-link','Attention buyer');
 state.search=linked;
 state.navigate.mockImplementation((path:string)=>{state.search=path.slice(path.indexOf('?'));});
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary(saved.id,'Attention buyer')]}:{sale:saved});
 const view=mount();
 await screen.findByRole('heading',{name:'Payments and documents'});
 fireEvent.click(screen.getByRole('button',{name:'Back to sales'}));
 expect(state.navigate).toHaveBeenCalledWith('/portal?section=sales',{replace:true});
 await screen.findByRole('heading',{name:'Sales'});
 state.search=linked;view.refresh();
 await screen.findByRole('heading',{name:'Payments and documents'});
 expect(reads().filter(url=>url==='/api/sale-workspace/attention-link')).toHaveLength(2);
 expect(writes()).toHaveLength(0);
});

it('keeps an unsaved customer edit when staff decline opening a sale attention link', async () => {
 const saved=full('current-dirty','Current buyer'), linked=full('linked-action','Linked buyer');
 state.navigate.mockImplementation((path:string)=>{state.search=path.slice(path.indexOf('?'));});
 state.api.mockImplementation(async(p:string)=>p==='/api/sale-workspace'?{sales:[summary(saved.id,'Current buyer')]}:{sale:p.endsWith(linked.id)?linked:saved});
 const view=mount();
 fireEvent.click(await screen.findByRole('button',{name:/Current buyer/}));
 await openCarScreen();
 fireEvent.click(screen.getByRole('button',{name:'Customer'}));
 const input=screen.getByRole('combobox',{name:'Customer’s full name'});
 fireEvent.change(input,{target:{value:'Unsaved edited buyer'}});
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 try {
  const link='?section=sales&saleId=linked-action&saleAction=payments';
  state.search=link;view.refresh();
  expect(confirm).toHaveBeenCalledOnce();
  expect(state.navigate).toHaveBeenCalledWith('/portal?section=sales',{replace:true});
  expect(input).toHaveValue('Unsaved edited buyer');
  expect(reads()).not.toContain('/api/sale-workspace/linked-action');
  view.refresh();
  confirm.mockReturnValue(true);
  state.search=link;view.refresh();
  await screen.findByRole('heading',{name:'Payments and documents'});
  expect(reads()).toContain('/api/sale-workspace/linked-action');
  expect(writes()).toHaveLength(0);
 } finally { confirm.mockRestore(); }
});
