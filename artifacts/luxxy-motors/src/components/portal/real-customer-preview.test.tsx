import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RealCustomerPreview, PreviewEnquiry } from './real-customer-preview';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { dealerConfig } from '@/config/dealer';
import { defaultBookingSettings } from '@/lib/test-drive-dates';
import type { TestSession } from '@/pages/sales-demo';
import { clearCustomerTestStorage } from '@/lib/customer-test-storage';
import { clearTestCustomerShortlist } from '@/lib/test-customer-shortlist-storage';
import { TestCustomerBrowser } from './test-customer-browser';

const { submitLive, stock }=vi.hoisted(()=>({submitLive:vi.fn(),stock:{schemaVersion:1,dealerName:'Example',dealerLocation:'Town',count:1,scrapedAt:null,cars:[{id:'car-one',advertId:'one',title:'Ford Fiesta',make:'Ford',model:'Fiesta',price:5000,currency:'GBP',year:2018,mileage:40000,transmission:'Manual',fuel:'Petrol',bodyType:'Hatchback',inventoryStatus:'available',images:[],heroImage:null,specifications:null,sourceExtras:null}]}}));
vi.mock('@/lib/stock-context',()=>({useStock:()=>({stock,isLoading:false,error:null})}));
vi.mock('@/lib/dealer-features',()=>({useDealerFeatures:()=>({data:{features:{testDriveBookings:true,publicEnquiries:true,partExchange:true}},isError:false,isLoading:false,isSuccess:true,enabled:(key:string)=>['testDriveBookings','publicEnquiries','partExchange'].includes(key)})}));
vi.mock('@workspace/api-client-react',async(load)=>{const real=await load<typeof import('@workspace/api-client-react')>();return {...real,useGetDealerSettings:()=>({data:undefined,isLoading:false,isError:false}),useCreateEnquiry:()=>({mutate:submitLive,isPending:false,isSuccess:false,reset:vi.fn()}),useGetRecentHandovers:()=>({data:{handovers:[]},isLoading:false,isError:false})};});
const session={sessionId:'practice',customer:{name:'Test buyer',email:'buyer@example.test',phone:'07123456789'},vehicle:{id:'car-one',title:'Ford Fiesta',registration:'',price:5000}} as unknown as TestSession;
const config={...dealerConfig,identity:{...dealerConfig.identity,name:'Practice dealer'},testDriveBooking:{...defaultBookingSettings,enabled:true},partExchange:{...dealerConfig.partExchange!,enabled:true}};
const submit=vi.fn().mockResolvedValue({appointmentStatus:null});
const renderPreview=(settings=config)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}})}><RealCustomerPreview session={session} config={settings as any} submit={submit}/></QueryClientProvider>);
beforeEach(()=>{clearTestCustomerShortlist('practice');clearCustomerTestStorage('practice');stock.cars[0].price=5000;window.history.replaceState({},'', '/portal?section=sales');localStorage.clear();sessionStorage.clear();localStorage.setItem('luxxy.saved-cars.v1',JSON.stringify(['real-car']));document.documentElement.dataset.testModeSession='practice';window.matchMedia=vi.fn().mockReturnValue({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});window.scrollTo=vi.fn();submit.mockClear();submitLive.mockClear();});
afterEach(()=>{delete document.documentElement.dataset.testModeSession;vi.restoreAllMocks();});

it('browses genuine stock and vehicle pages, isolates saves, and keeps the portal URL',async()=>{
 renderPreview();
 fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
 const links=await screen.findAllByRole('link',{name:/Ford Fiesta/i});fireEvent.click(links[0]);
 expect(await screen.findByRole('heading',{name:'Ford Fiesta',level:1})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Save Ford Fiesta to your saved cars/i}));
 expect(localStorage.getItem('luxxy.saved-cars.v1')).toBe('["real-car"]');
 fireEvent.click(screen.getByRole('button',{name:'Saved cars'}));
 expect(await screen.findByRole('heading',{name:/Saved cars/i})).toBeVisible();
 expect(screen.getAllByText('Ford Fiesta').length).toBeGreaterThan(0);
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
 expect(submitLive).not.toHaveBeenCalled();
});

it('shares practice saves and simulated watches across real pages and preview reopening',async()=>{
 const preview=renderPreview();
 fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 fireEvent.click(await screen.findByRole('button',{name:/Save Ford Fiesta to your saved cars/i}));
 fireEvent.click(screen.getByRole('button',{name:'Practise watching'}));
 fireEvent.change(screen.getByLabelText('Email address for practice watch'),{target:{value:'practice@example.test'}});
 fireEvent.click(screen.getByRole('button',{name:'Practise request'}));
 fireEvent.click(screen.getByRole('button',{name:'Simulate confirmation'}));
 fireEvent.click(screen.getByRole('button',{name:'Saved cars'}));
 expect(await screen.findByText('Ford Fiesta — confirmed')).toBeVisible();
 expect(screen.getAllByText('Ford Fiesta').length).toBeGreaterThan(0);
 expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["real-car"]');
 preview.unmount();
 renderPreview();
 fireEvent.click(await screen.findByRole('button',{name:'Saved cars'}));
 expect(await screen.findByText('Ford Fiesta — confirmed')).toBeVisible();
 expect(screen.getAllByText('Ford Fiesta').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Stop practice watch'}));
 expect(screen.getByText('No practice watched cars.')).toBeVisible();
 expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["real-car"]');
 expect(submitLive).not.toHaveBeenCalled();
});

it('still shows a practice saved-car price reduction after a simulated reload',async()=>{
 const preview=renderPreview();
 fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 fireEvent.click(await screen.findByRole('button',{name:/Save Ford Fiesta to your saved cars/i}));
 preview.unmount(); clearCustomerTestStorage('practice');
 stock.cars[0].price=4500;
 renderPreview();fireEvent.click(await screen.findByRole('button',{name:'Saved cars'}));
 expect(await screen.findByText('Price reduced by £500 since you saved it')).toBeVisible();
 expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["real-car"]');
 expect(window.localStorage.getItem('luxxy.saved-car-snapshots.v1')).toBeNull();
});

it('synchronises the two actual preview panels while both remain open',async()=>{
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}})}><RealCustomerPreview session={session} config={config as any} submit={submit}/><TestCustomerBrowser session={session} config={config as any} submit={submit}/></QueryClientProvider>);
 const simple=within(screen.getByRole('region',{name:'Customer website test browser'}));
 fireEvent.click(await simple.findByRole('button',{name:'Save Ford Fiesta to saved cars'}));
 fireEvent.click(await screen.findByRole('button',{name:/^Stock$/}));
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 expect(await screen.findByRole('button',{name:/Remove Ford Fiesta from your saved cars/i})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Remove Ford Fiesta from your saved cars/i}));
 expect(simple.getByRole('button',{name:'Save Ford Fiesta to saved cars'})).toBeVisible();
 fireEvent.click(simple.getByRole('button',{name:'View car'}));
 fireEvent.click(simple.getByRole('button',{name:'Practise watching'}));
 fireEvent.change(simple.getByLabelText('Email address for practice watch'),{target:{value:'practice@example.test'}});
 fireEvent.click(simple.getByRole('button',{name:'Practise request'}));
 expect(screen.getAllByText(/Practice watch awaiting confirmation/)).toHaveLength(2);
 expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["real-car"]');
});

it('uses the public site booking wording for copied settings in the vehicle preview',async()=>{
 const copied={...config,bookViewing:{...config.bookViewing,ctaLabel:'Book a Viewing'}};
 renderPreview(copied);fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 expect(await screen.findByRole('heading',{name:'Ford Fiesta',level:1})).toBeVisible();
 expect(screen.getAllByRole('button',{name:'Book a Test Drive'}).length).toBeGreaterThan(0);
 expect(copied.bookViewing.ctaLabel).toBe('Book a Viewing');
});

it('opens a genuine test-drive form for the selected car and does not expose contact actions',async()=>{
 renderPreview();fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 expect(await screen.findByRole('heading',{name:'Ford Fiesta',level:1})).toBeVisible();
 expect(screen.queryByRole('button',{name:/WhatsApp about/i})).toBeNull();
 expect(screen.queryByRole('link',{name:/Call about/i})).toBeNull();
 const booking=screen.getAllByRole('button',{name:/Book a test drive|Choose a test-drive time/i});fireEvent.click(booking[0]);
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Book a Test Drive'})).toBeVisible());
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
 expect(submitLive).not.toHaveBeenCalled();
});


it('submits an embedded genuine enquiry only to the test callback for the displayed car',async()=>{
 renderPreview();fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 fireEvent.change(await screen.findByTestId('textarea-enquiry-message'),{target:{value:'Can I see this car?'}});
 fireEvent.submit(screen.getByTestId('form-enquiry'));
 await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({vehicleId:'car-one',message:'Can I see this car?'})));
 expect(submitLive).not.toHaveBeenCalled();
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
});

it('uses the selected car when submitting the genuine part-exchange form',async()=>{
 renderPreview();fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 fireEvent.click(await screen.findByRole('button',{name:/Value my car/i}));
 fireEvent.change(screen.getByTestId('input-part-exchange-registration'),{target:{value:'AB12 CDE'}});
 fireEvent.change(screen.getByTestId('input-part-exchange-mileage'),{target:{value:'45000'}});
 fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
 fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
 await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({vehicleId:'car-one',type:'part_exchange'})));
 expect(submitLive).not.toHaveBeenCalled();
});

it('hides booking and part exchange when disabled in copied settings',async()=>{
 renderPreview({...config,testDriveBooking:{...defaultBookingSettings,enabled:false},partExchange:{...config.partExchange,enabled:false}});
 fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 expect(await screen.findByRole('heading',{name:'Ford Fiesta',level:1})).toBeVisible();
 expect(screen.queryByRole('button',{name:/Book a test drive|Choose a test-drive time|Value my car/i})).toBeNull();
});

it('applies quick-filter links inside the memory router without changing the portal address',async()=>{
 renderPreview();
 const link=await screen.findByRole('link',{name:/Under £10k/i});
 fireEvent.click(link);
 await waitFor(()=>expect(screen.getByTestId('text-filtered-stock-count')).toHaveTextContent('1 car'));
 expect(screen.getByTestId('input-showroom-search')).toBeVisible();
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
});

it('blocks an external contact or unknown live page from leaving the preview',async()=>{
 const view=renderPreview();await screen.findByRole('button',{name:'Stock'});
 const root=screen.getByLabelText('Customer test preview navigation').parentElement!;
 const anchor=document.createElement('a');anchor.href='https://external.example/contact';root.appendChild(anchor);
 const external=new MouseEvent('click',{bubbles:true,cancelable:true});anchor.dispatchEvent(external);
 expect(external.defaultPrevented).toBe(true);
 anchor.setAttribute('href','tel:02000000000');const dial=new MouseEvent('click',{bubbles:true,cancelable:true});anchor.dispatchEvent(dial);
 expect(dial.defaultPrevented).toBe(true);
 anchor.setAttribute('href','/contact');const contact=new MouseEvent('click',{bubbles:true,cancelable:true});anchor.dispatchEvent(contact);
 expect(contact.defaultPrevented).toBe(true);
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
 anchor.remove();view.unmount();
});

it('uses the actual contact page without external contact links and submits a general enquiry without a car',async()=>{
 renderPreview();fireEvent.click(await screen.findByRole('button',{name:'Contact'}));
 expect(await screen.findByRole('button',{name:'Send an enquiry'})).toBeVisible();
 expect(screen.queryByTestId('contact-phone')).toBeNull();expect(screen.queryByTestId('contact-whatsapp')).toBeNull();expect(screen.queryByTestId('contact-email')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Send an enquiry'}));
 fireEvent.change(await screen.findByTestId('textarea-enquiry-message'),{target:{value:'Do you offer finance?'}});
 fireEvent.submit(screen.getByTestId('form-enquiry'));
 await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({vehicleId:null,message:'Do you offer finance?'})));
 expect(submitLive).not.toHaveBeenCalled();expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
});

it('shows the actual customer header and footer without exposing communication or live links',async()=>{
 const withContact={...config,contact:{phone:'02012345678',email:'sales@example.test',whatsapp:'+447700900000'},social:{...config.social,facebook:'https://example.test/social'},legal:{...config.legal,privacyUrl:'https://example.test/privacy'}};
 const view=renderPreview(withContact);
 await screen.findByRole('button',{name:'Stock'});
 const header=view.container.querySelector('header[data-site-header]');
 const footer=view.container.querySelector('footer.dealership-footer');
 expect(header).not.toBeNull();expect(footer).not.toBeNull();
 expect(header!.querySelectorAll('a[href]')).toHaveLength(0);
 expect(footer!.querySelectorAll('a[href]')).toHaveLength(0);
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
});

it('never exposes live hrefs on the tested customer pages or forms',async()=>{
 const view=renderPreview();
 const noLinks=()=>expect(Array.from(view.container.querySelectorAll('a[href]')).map(a=>a.getAttribute('href'))).toEqual([]);
 await screen.findByRole('button',{name:'Stock'});noLinks();
 fireEvent.click(screen.getByRole('button',{name:'Stock'}));noLinks();
 fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
 await screen.findByRole('heading',{name:'Ford Fiesta',level:1});noLinks();
 const booking=screen.getAllByRole('button',{name:/Book a test drive|Choose a test-drive time/i});fireEvent.click(booking[0]);
 await screen.findByRole('heading',{name:'Book a Test Drive'});noLinks();
 fireEvent.click(screen.getByRole('button',{name:'Contact'}));await screen.findByRole('button',{name:'Send an enquiry'});noLinks();
 fireEvent.click(screen.getByRole('button',{name:'Send an enquiry'}));await screen.findByTestId('textarea-enquiry-message');noLinks();
});

it('keeps gallery portals free of contact URLs and routes the booking callback',async()=>{
 const car=stock.cars[0] as any,originalImages=car.images,originalHero=car.heroImage;
 car.images=Array.from({length:12},(_,i)=>`https://images.example.test/${i}.jpg`);car.heroImage=car.images[0];
 try {
  renderPreview();fireEvent.click(await screen.findByRole('button',{name:'Stock'}));
  fireEvent.click((await screen.findAllByRole('link',{name:/Ford Fiesta/i}))[0]);
  fireEvent.click(await screen.findByRole('button',{name:'View gallery fullscreen'}));
  const dialog=await screen.findByRole('dialog',{name:'Vehicle image gallery'});
  expect(dialog.querySelectorAll('a[href]')).toHaveLength(0);
  expect(dialog.querySelectorAll('[href^="tel:"],[href^="https:"]')).toHaveLength(0);
  fireEvent.keyDown(dialog,{key:'Escape'});
  fireEvent.click(screen.getByRole('button',{name:'Show photograph 10 of 12'}));
  fireEvent.click(within(screen.getByRole('region',{name:'Like what you see?'})).getByRole('button',{name:'Book a Test Drive'}));
  expect(await screen.findByRole('heading',{name:'Book a Test Drive'})).toBeVisible();
  expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
 } finally {car.images=originalImages;car.heroImage=originalHero;}
});


it('does not silently turn an explicitly missing car into a general enquiry',()=>{
 const route=memoryLocation({path:'/enquire?type=general&vehicleId=missing-car'});
 render(<Router hook={route.hook}><PreviewEnquiry session={session} config={config as any} submit={submit}/></Router>);
 expect(screen.getByRole('alert')).toHaveTextContent('The selected car is unavailable');
 expect(screen.queryByTestId('form-enquiry')).toBeNull();
 expect(submit).not.toHaveBeenCalled();expect(submitLive).not.toHaveBeenCalled();
});

it('offers a way to choose a car when booking from the header without a vehicle',async()=>{
 renderPreview();await screen.findByRole('button',{name:'Stock'});
 fireEvent.click(screen.getAllByRole('button',{name:'Book a Test Drive'})[0]);
 expect(await screen.findByRole('alert')).toHaveTextContent('Choose a car');
 fireEvent.click(screen.getByRole('button',{name:'Choose a car'}));
 expect(await screen.findByTestId('input-showroom-search')).toBeVisible();
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
});
