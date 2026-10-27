import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
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
