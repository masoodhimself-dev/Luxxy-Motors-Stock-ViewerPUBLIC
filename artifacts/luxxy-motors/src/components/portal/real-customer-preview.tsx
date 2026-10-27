import { useEffect, useState, type MouseEvent } from 'react';
import { Router, Route, Switch, useLocation, useRoute, useSearch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { EnquiryInput, DealerSettings } from '@workspace/api-client-react';
import type { DealerConfig } from '@/config/dealer';
import { CustomerPreviewSettingsProvider, normaliseDealerWording, useDealerSettings } from '@/lib/dealer-settings-context';
import { customerTestSession } from '@/lib/customer-test-storage';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { useStock, type Car } from '@/lib/stock-context';
import { vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import Home from '@/pages/home';
import { CarDetailContent } from '@/pages/car-detail';
import Saved from '@/pages/saved';
import { ContactContent } from '@/pages/contact';
import { WarrantyContent } from '@/pages/warranty';
import { EnquirePage } from '@/pages/enquire';
import { Layout } from '@/components/layout';
import type { TestSession } from '@/pages/sales-demo';
import { TestCustomerWatches, TestSaveWatchControls, useTestCustomerShortlist } from './test-customer-saved-watch';

type FormType = 'general' | 'viewing' | 'part_exchange';
type PreviewProps = { session:TestSession; config:ReturnType<typeof useDealerSettings>['settings']; submit:(input:EnquiryInput)=>Promise<{appointmentStatus:string|null}> };

/** Experimental harness: navigation and external links must remain within this
 * router. Never mount until the test-mode request guard is installed. */
export function RealCustomerPreview(props:PreviewProps) {
  const [location] = useState(() => memoryLocation({path:'/'}));
  const shortlist=useTestCustomerShortlist(props.session.sessionId);
  const {stock}=useStock();
  const [ready,setReady]=useState(false);
  const [guidance,setGuidance]=useState('');
  useEffect(()=>{ setReady(customerTestSession()===props.session.sessionId); },[props.session.sessionId]);
  if(!ready || customerTestSession()!==props.session.sessionId) return <p role="status">Preparing the isolated customer preview…</p>;
  const chooseCar=()=>{setGuidance('Choose a car, then start the enquiry or booking from its page.');location.navigate('/stock');};
  const general=()=>{setGuidance('');location.navigate('/enquire?type=general');};
  const route=(type:FormType,car:Car)=>{setGuidance('');location.navigate(`/enquire?type=${type}&vehicleId=${encodeURIComponent(car.id)}`);};
  const safeLink=(event:MouseEvent<HTMLDivElement>)=>{
    const target=event.target instanceof Element ? event.target.closest('a[href]') : null;
    if(!target || target.hasAttribute('data-test-safe-link'))return;
    const href=target.getAttribute('href') ?? '';
    event.preventDefault(); event.stopPropagation();
    if(href.startsWith('#')) {
      const id=href.slice(1);
      if(/^[a-zA-Z0-9_-]+$/.test(id)) document.getElementById(id)?.scrollIntoView({block:'start'});
      return;
    }
    let url:URL;
    try{url=new URL(href,window.location.origin);}catch{return;}
    if(url.origin!==window.location.origin || target.hasAttribute('download') || target.getAttribute('target')==='_blank')return;
    if(!/^\/(?:|stock|saved|contact|warranty|vehicle\/[^/]+|enquire)$/.test(url.pathname))return;
    location.navigate(url.pathname+url.search);
  };
  const config = normaliseDealerWording(props.config);
  return <CustomerPreviewSettingsProvider settings={config as DealerConfig & DealerSettings}><SavedCarsProvider testSessionId={props.session.sessionId} practiceShortlist={shortlist}>
    <Router hook={location.hook}>
      <div onClickCapture={safeLink}>
        <p role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-900">Customer test preview. Contact links and sharing are unavailable. Changes stay in this test.</p>
        {guidance && <p role="status">{guidance}</p>}
        <nav aria-label="Customer test preview navigation" className="flex gap-2"><button type="button" onClick={()=>location.navigate('/')}>Home</button><button type="button" onClick={()=>location.navigate('/stock')}>Stock</button><button type="button" onClick={()=>location.navigate('/saved')}>Saved cars</button><button type="button" onClick={()=>location.navigate('/contact')}>Contact</button><button type="button" onClick={()=>location.navigate('/warranty')}>Warranty</button></nav>
        <Layout testMode><Switch>
          <Route path="/"><Home /></Route>
          <Route path="/stock"><Home key="test-stock" browseStock /></Route>
          <Route path="/saved"><Saved /><TestCustomerWatches cars={stock?.cars??[]} shortlist={shortlist} openCar={car=>location.navigate(`/vehicle/${encodeURIComponent(car.id)}`)} /></Route>
          <Route path="/contact"><ContactContent testMode={{openGeneralEnquiry:general,openBooking:chooseCar}} /></Route>
          <Route path="/warranty"><WarrantyContent testMode={{openGeneralEnquiry:car=>car ? route('general',car) : general()}} /></Route>
          <Route path="/vehicle/:id"><PreviewVehicle {...props} config={config} openForm={route} shortlist={shortlist} /></Route>
          <Route path="/enquire"><PreviewEnquiry {...props} config={config} /></Route>
          <Route><p>That page is unavailable in this test preview.</p></Route>
        </Switch></Layout>
      </div>
    </Router>
  </SavedCarsProvider></CustomerPreviewSettingsProvider>;
}
function PreviewVehicle(props:PreviewProps & {openForm:(type:FormType,car:Car)=>void;shortlist:ReturnType<typeof useTestCustomerShortlist>}) {
  const [,params]=useRoute('/vehicle/:id');
  const {stock}=useStock();
  const car=stock?.cars.find(item=>item.id===params?.id);
  return params?.id ? <><CarDetailContent testMode={{carId:params.id,config:props.config,customer:props.session.customer,submit:props.submit,openForm:props.openForm}}/>{car&&<div className="container mx-auto p-4"><TestSaveWatchControls key={car.id} car={car} shortlist={props.shortlist} showSave={false}/></div>}</> : null;
}
export function PreviewEnquiry({session,config,submit}:PreviewProps) {
  const search=useSearch(),{stock,isLoading,error}=useStock();
  const [,navigate]=useLocation();
  const params=new URLSearchParams(search),requested=params.get('type'),vehicleId=params.get('vehicleId');
  const type:FormType=requested==='viewing'||requested==='part_exchange'?requested:'general';
  const car=stock?.cars.find(item=>item.id===vehicleId);
  if(vehicleId && isLoading) return <p role="status">Checking the selected car…</p>;
  if(vehicleId && (error || !stock || !car || ['sold','archived','hidden'].includes(String(car.inventoryStatus).toLowerCase()))) return <div role="alert"><p>The selected car is unavailable. Choose a current car before sending this enquiry.</p><button type="button" onClick={()=>navigate('/stock')}>Choose a car</button></div>;
  if(!car && type!=='general') return <div role="alert"><p>Choose a car before opening a test form.</p><button type="button" onClick={()=>navigate('/stock')}>Choose a car</button></div>;
  return <EnquirePage key={`${car?.id??'no-car'}:${type}`} testMode={{type,sessionId:session.sessionId,config,customer:session.customer,vehicle:car ? {id:car.id,title:vehicleDisplayTitle(car),registration:vehicleRegistration(car)??'',price:car.price} : null,submit}}/>;
}
