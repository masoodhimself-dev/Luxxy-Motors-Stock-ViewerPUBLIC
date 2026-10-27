import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dealerConfig } from '@/config/dealer';
import { defaultBookingSettings } from '@/lib/test-drive-dates';
import Portal from './portal';

const state=vi.hoisted(()=>({active:false,writes:[] as any[],liveRequests:[] as any[],enquiries:[] as any[]}));
const session={sessionId:'00000000-0000-4000-8000-000000000123',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'car-one',title:'Ford Fiesta',registration:'',price:5000},customer:{name:'Test Buyer',phone:'07700900000',email:'buyer@example.test',address:''}};
const config={...dealerConfig,identity:{...dealerConfig.identity,name:'Practice dealer'},testDriveBooking:{...defaultBookingSettings,enabled:true},partExchange:{...dealerConfig.partExchange!,enabled:true}};
const stock={schemaVersion:1,dealerName:'Practice dealer',count:1,cars:[{id:'car-one',advertId:'one',title:'Ford Fiesta',make:'Ford',model:'Fiesta',price:5000,currency:'GBP',year:2018,mileage:40000,transmission:'Manual',fuel:'Petrol',bodyType:'Hatchback',inventoryStatus:'available',images:[],heroImage:null,specifications:null,sourceExtras:null}]};
vi.mock('@clerk/react',()=>({useAuth:()=>({isLoaded:true,isSignedIn:true}),useUser:()=>({user:{id:'operator',firstName:'Operator'}}),UserButton:()=>null,SignInButton:({children}:any)=>children}));
vi.mock('@/lib/stock-context',()=>({useStock:()=>({stock,isLoading:false,error:null})}));
vi.mock('@/lib/dealer-features',()=>({useDealerFeatures:()=>({data:{features:{testDriveBookings:true,publicEnquiries:true,partExchange:true}},isError:false,isLoading:false,isSuccess:true,enabled:(key:string)=>['testDriveBookings','publicEnquiries','partExchange'].includes(key)})}));
vi.mock('@/components/portal/dealer-administration',()=>({useStaffAccess:()=>({data:{permissions:['sales.manage','settings.publish'],user:{authUserId:'operator'}},isLoading:false,isError:false}),DealerSettingsHub:()=>null}));
vi.mock('@/components/portal/notifications-workspace',()=>({NotificationsWorkspace:()=> <p>Live inbox</p>}));
vi.mock('@/components/portal/quick-enquiry',()=>({QuickEnquiryDialog:()=>null}));
vi.mock('@/components/portal/device-notifications',()=>({PortalInstallMetadata:()=>null}));
vi.mock('@/components/portal/history-links',()=>({ContextHistoryDialog:()=>null}));
vi.mock('@/components/portal/dealer-reports',()=>({DealerReports:()=>null}));
vi.mock('@/pages/sales-demo',()=>({SalesWorkspace:()=>null}));
vi.mock('@workspace/api-client-react',async(load)=>{
 const real=await load<typeof import('@workspace/api-client-react')>();
 return {...real,useGetPortalSession:()=>({data:{state:'allowed',name:'Operator'},isLoading:false,isError:false}),useGetDealerSettings:()=>({data:undefined,isLoading:false,isError:false}),useCreateEnquiry:()=>({mutate:()=>{throw new Error('Live enquiry attempted');},isPending:false,isSuccess:false,reset:vi.fn()}),useGetRecentHandovers:()=>({data:{handovers:[]},isLoading:false,isError:false}),
 customFetch:async(path:string,options?:RequestInit)=>{
  const method=options?.method??'GET';
  if(path==='/api/sales-test/sessions' && method==='GET')return {session:state.active?session:null};
  if(path==='/api/sales-test/available-vehicles')return {cars:[{id:'car-one',title:'Ford Fiesta',registration:'',price:5000}]};
  if(path==='/api/sales-test/available-customers')return {customers:[{id:'customer-one',source:'customer',name:'Test Buyer',phone:'07700900000',email:'buyer@example.test'}]};
  if(path==='/api/sales-test/sessions' && method==='POST'){state.active=true;return session;}
  if(path.endsWith('/settings'))return {config,revision:1};
  if(path.includes('/email-history'))return {messages:[]};
  if(path.endsWith('/enquiries')&&method==='GET')return {enquiries:state.enquiries};
  if(path.endsWith('/enquiries')&&method==='POST'){const data=JSON.parse(String(options?.body));state.writes.push(data);const enquiry={id:`test-${state.writes.length}`,type:data.type,vehicleId:data.vehicleId,vehicleTitle:data.vehicleId?'Ford Fiesta':'',customerName:data.contact.name,phone:data.contact.phone,email:data.contact.email,message:data.message,partExchange:data.partExchange,appointmentStatus:null,revision:1};state.enquiries=[enquiry,...state.enquiries];return {enquiry};}
  return {};
 }};
});
beforeEach(()=>{state.active=false;state.writes=[];state.liveRequests=[];state.enquiries=[];sessionStorage.clear();localStorage.clear();localStorage.setItem('luxxy.saved-cars.v1','["real-car"]');window.history.replaceState({},'','/portal?section=notifications');window.matchMedia=vi.fn().mockReturnValue({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});window.scrollTo=vi.fn();global.ResizeObserver=class{observe(){}disconnect(){}unobserve(){}};vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo | URL,init?:RequestInit)=>{const headers=new Headers(init?.headers);state.liveRequests.push({input:String(input),marker:headers.get('x-luxxy-test-session')});return new Response('{}',{status:403});}));});
afterEach(()=>{delete document.documentElement.dataset.testModeSession;vi.unstubAllGlobals();vi.restoreAllMocks();});

it('enters test mode, opens the real-page preview and keeps enquiries and live requests isolated',async()=>{
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Portal/></QueryClientProvider>);
 fireEvent.keyDown(await screen.findByRole('button',{name:'More workspace options'}),{key:'Enter'});fireEvent.click(await screen.findByRole('menuitem',{name:'Start test mode'}));
 await screen.findByRole('option',{name:'Ford Fiesta'});await screen.findByRole('option',{name:/Test Buyer/});
 fireEvent.change(screen.getByRole('combobox',{name:'Car'}),{target:{value:'car-one'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Customer'}),{target:{value:'customer:customer-one'}});
 fireEvent.click(screen.getByRole('button',{name:'Start test'}));
 expect(await screen.findByText('Test mode')).toBeVisible();
 await waitFor(()=>expect(document.documentElement.dataset.testModeSession).toBe(session.sessionId));
 fireEvent.click(screen.getByText('Try actual customer website (preview)'));
 const region=await screen.findByRole('region',{name:'Actual customer website test preview'});
 fireEvent.click(await within(region).findByRole('button',{name:'Stock'}));
 fireEvent.click((await within(region).findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 fireEvent.change(await within(region).findByTestId('textarea-enquiry-message'),{target:{value:'Is this car available?'}});
 fireEvent.submit(within(region).getByTestId('form-enquiry'));
 await waitFor(()=>expect(state.writes).toEqual([expect.objectContaining({vehicleId:'car-one',message:'Is this car available?'})]));
 fireEvent.click(within(region).getByRole('button',{name:'Contact'}));
 fireEvent.click(await within(region).findByRole('button',{name:'Send an enquiry'}));
 fireEvent.change(await within(region).findByTestId('textarea-enquiry-message'),{target:{value:'Do you arrange finance?'}});
 fireEvent.submit(within(region).getByTestId('form-enquiry'));
 await waitFor(()=>expect(state.writes).toHaveLength(2));
 expect(state.writes[1]).toMatchObject({vehicleId:null,message:'Do you arrange finance?'});
 expect(localStorage.getItem('luxxy.saved-cars.v1')).toBe('["real-car"]');
 const blocked=await fetch('/api/enquiries',{method:'POST',body:'{}'});
 expect(blocked.status).toBe(403);expect(state.liveRequests.at(-1)).toMatchObject({input:'/api/enquiries',marker:session.sessionId});
 expect(window.location.pathname+window.location.search).toContain('/portal');
});
