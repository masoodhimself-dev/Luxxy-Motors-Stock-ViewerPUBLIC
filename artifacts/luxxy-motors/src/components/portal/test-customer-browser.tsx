import { useMemo, useState } from 'react';
import type { EnquiryInput } from '@workspace/api-client-react';
import { useStock, type Car } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useDealerFeatures } from '@/lib/dealer-features';
import { Filters, type FilterState } from '@/components/filters';
import { bodyTypeKey } from '@/lib/body-types';
import { vehicleBenefits } from '@/lib/vehicle-benefits';
import { vehicleContent } from '@/lib/vehicle-content';
import { arrivalTime } from '@/lib/stock-presentation';
import { formatMileage, formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EnquirePage } from '@/pages/enquire';
import type { TestSession } from '@/pages/sales-demo';
import { TestCustomerShortlist, TestSaveCarButton, TestSaveWatchControls, useTestCustomerShortlist } from './test-customer-saved-watch';

const empty:FilterState={make:'',model:'',minPrice:'',maxPrice:'',fuel:'',transmission:'',bodyType:'',search:'',ulez:false,sort:''};
type TestPage='home'|'stock'|'vehicle'|'saved'|'general'|'viewing'|'part_exchange';

/** Isolated customer preview. Stock is read-only and all forms use test APIs. */
export function TestCustomerBrowser({session,config,submit}:{session:TestSession;config:ReturnType<typeof useDealerSettings>['settings'];submit:(input:EnquiryInput)=>Promise<{appointmentStatus:string|null}>}) {
  const {stock,isLoading,error}=useStock();
  const features=useDealerFeatures();
  const canBook=Boolean(config.testDriveBooking?.enabled && features.enabled('testDriveBookings'));
  const canExchange=Boolean(config.partExchange?.enabled && features.enabled('partExchange'));
  const shortlist=useTestCustomerShortlist(session.sessionId);
  const [page,setPage]=useState<TestPage>('home');const [vehicle,setVehicle]=useState<Car|null>(null);const [filters,setFilters]=useState<FilterState>(empty);
  const cars=useMemo(()=>(stock?.cars??[]).filter(car=>!['sold','archived','hidden'].includes(String(car.inventoryStatus).toLowerCase())),[stock?.cars]);
  const matches=useMemo(()=>{
    const q=filters.search.trim().toLowerCase(),registration=q.replace(/[\s-]/g,'');
    const result=cars.filter(car=>{
      if(q && ![car.title,car.make,car.model].some(v=>v?.toLowerCase().includes(q)) && ![car.plate,car.vrm,car.registration].some(v=>registration&&v?.toLowerCase().replace(/[\s-]/g,'').includes(registration)))return false;
      if(filters.make&&car.make!==filters.make||filters.model&&car.model!==filters.model||filters.fuel&&car.fuel!==filters.fuel)return false;
      if(filters.bodyType&&bodyTypeKey(car.bodyType)!==bodyTypeKey(filters.bodyType))return false;
      if(filters.transmission&&(filters.transmission.toLowerCase()==='automatic'?!/automatic/i.test(car.transmission||''):car.transmission?.toLowerCase()!==filters.transmission.toLowerCase()))return false;
      if(filters.ulez&&!vehicleBenefits(car).ulez)return false;
      if(filters.minPrice && (car.price==null||car.price<Number(filters.minPrice)))return false;
      if(filters.maxPrice && (car.price==null||car.price>Number(filters.maxPrice)))return false;
      return true;
    });
    if(filters.sort) result.sort((a,b)=>{const field=filters.sort.startsWith('price')?'price':filters.sort==='year-desc'?'year':'mileage';const x=filters.sort==='arrival-desc'?arrivalTime(a):a[field],y=filters.sort==='arrival-desc'?arrivalTime(b):b[field];if(x==null||!Number.isFinite(x))return y==null||!Number.isFinite(y)?0:1;if(y==null||!Number.isFinite(y))return -1;return filters.sort.endsWith('asc')?x-y:y-x;});
    return result;
  },[cars,filters]);
  const open=(car:Car)=>{setVehicle(car);setPage('vehicle');};
  const list=(items:Car[])=><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map(car=><article key={car.id} className="overflow-hidden rounded border bg-card">{getThumbnailUrl(car)&&<img className="aspect-[4/3] w-full object-cover" src={getThumbnailUrl(car)} alt="" loading="lazy" referrerPolicy="no-referrer"/>}<div className="space-y-2 p-4"><h3 className="font-semibold">{vehicleDisplayTitle(car)}</h3><p>{car.price!=null?formatPrice(car.price,car.currency):'Price on request'}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={()=>open(car)}>View car</Button><TestSaveCarButton car={car} shortlist={shortlist}/></div></div></article>)}</div>;
  const content=vehicle?vehicleContent(vehicle):null;
  const formVehicle=vehicle?{id:vehicle.id,title:vehicleDisplayTitle(vehicle),registration:vehicle.registration||vehicle.plate||vehicle.vrm||'',price:vehicle.price??0}:session.vehicle;
  return <section aria-label="Customer website test browser" className="space-y-4 rounded border bg-background p-4">
    <div className="rounded bg-amber-50 p-3 text-sm text-amber-900">Test website preview · Browsing uses live stock read-only. Enquiries and bookings are saved only in this test session.</div>
    <nav aria-label="Test website navigation" className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={()=>setPage('home')}>Home</Button><Button type="button" variant="outline" onClick={()=>setPage('stock')}>Browse stock</Button><Button type="button" variant="outline" onClick={()=>setPage('saved')}>Saved &amp; practice watches ({shortlist.savedIds.length})</Button><Button type="button" variant="outline" onClick={()=>setPage('general')}>Enquiry</Button>{canBook&&<Button type="button" variant="outline" onClick={()=>setPage('viewing')}>Test drive</Button>}{canExchange&&<Button type="button" variant="outline" onClick={()=>setPage('part_exchange')}>Part exchange</Button>}</nav>
    {isLoading&&<p role="status">Loading stock…</p>}{error&&<p role="alert">Could not load stock for this preview.</p>}
    {page==='home'&&<><header><p className="text-sm">{config.identity.name}</p><h2 className="text-2xl font-semibold">{config.hero.copy}</h2><p>{config.hero.subcopy}</p></header><Button type="button" onClick={()=>setPage('stock')}>Browse cars</Button>{list(cars.slice(0,3))}</>}
    {page==='stock'&&<><h2 className="text-xl font-semibold">Browse cars</h2><Filters cars={cars} filters={filters} setFilters={setFilters} vehicleCount={cars.length} matchCount={matches.length}/><p>{matches.length} {matches.length===1?'car':'cars'}</p>{list(matches)}</>}
    {page==='saved'&&<TestCustomerShortlist cars={cars} shortlist={shortlist} openCar={open}/>}
    {page==='vehicle'&&vehicle&&<><Button type="button" variant="outline" onClick={()=>setPage('stock')}>Back to stock</Button><h2 className="text-2xl font-semibold">{vehicleDisplayTitle(vehicle)}</h2>{getThumbnailUrl(vehicle)&&<img src={getThumbnailUrl(vehicle)} alt="" className="max-h-96 w-full object-contain" referrerPolicy="no-referrer"/>}<p>{vehicle.price!=null?formatPrice(vehicle.price,vehicle.currency):'Price on request'}</p><p>{[vehicle.year,vehicle.mileage!=null?formatMileage(vehicle.mileage):null,vehicle.fuel,vehicle.transmission].filter(Boolean).join(' · ')}</p><TestSaveWatchControls key={vehicle.id} car={vehicle} shortlist={shortlist}/>{content?.description&&<p className="whitespace-pre-wrap">{content.description}</p>}{content?.features.length?<><h3 className="font-semibold">Features</h3><ul className="list-disc pl-5">{content.features.map(feature=><li key={feature}>{feature}</li>)}</ul></>:null}<div className="flex flex-wrap gap-2"><Button type="button" onClick={()=>setPage('general')}>Enquire about this car</Button>{canBook&&<Button type="button" variant="outline" onClick={()=>setPage('viewing')}>Book a test drive</Button>}{canExchange&&<Button type="button" variant="outline" onClick={()=>setPage('part_exchange')}>Part exchange</Button>}</div></>}
    {['general','viewing','part_exchange'].includes(page)&&<EnquirePage key={`${page}:${formVehicle.id}`} testMode={{type:page as 'general'|'viewing'|'part_exchange',sessionId:session.sessionId,config,customer:session.customer,vehicle:formVehicle,submit}}/>}
  </section>;
}
