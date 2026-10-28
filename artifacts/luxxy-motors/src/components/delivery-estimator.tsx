import {useEffect,useRef,useState} from 'react';
import {customFetch} from '@workspace/api-client-react';
import {useDealerSettings} from '@/lib/dealer-settings-context';
import {PostcodeField} from './postcode-field';
import {Button} from './ui/button';
export type DeliveryEstimate={postcode:string;roadMiles:number;basePricePence:number;pricePerMilePence:number;mileageChargePence:number;totalPence:number;distanceBasis:'driving';estimated:true};
const pounds=(pence:number)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pence/100);
export function DeliveryEstimator(){
 const {settings}=useDealerSettings(),pricing=settings.deliveryPricing;
 const [postcode,setPostcode]=useState(''),[busy,setBusy]=useState(false),[estimate,setEstimate]=useState<DeliveryEstimate|null>(null),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null);
 const enabled=Boolean(settings.delivery?.enabled && pricing?.enabled);
 useEffect(()=>{request.current?.abort();setEstimate(null);setError('');setBusy(false);},[pricing?.basePrice,pricing?.pricePerMile,enabled,settings.address?.postcode]);
 useEffect(()=>()=>request.current?.abort(),[]);
 if(!enabled)return null;
 function change(value:string){request.current?.abort();setBusy(false);setPostcode(value);setEstimate(null);setError('');}
 async function calculate(){
  request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');setEstimate(null);
  try{
   const result=await customFetch<DeliveryEstimate>(`/api/postcodes/delivery-estimate?postcode=${encodeURIComponent(postcode.trim())}`,{signal:controller.signal});
   if(controller.signal.aborted)return;
   if(result.distanceBasis!=='driving'||!Number.isFinite(result.totalPence)||!Number.isFinite(result.roadMiles))throw Error('No road estimate');
   setPostcode(result.postcode);setEstimate(result);
  }catch(cause){if(!controller.signal.aborted){const code=(cause as {data?:{code?:string}})?.data?.code;setError(code==='invalid'||code==='not_found'?'Please check your postcode and try again.':'We couldn’t calculate a road delivery estimate. Please contact us for a quote.');}}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 return <details aria-label="Delivery cost estimate" className="mt-4 rounded-md border border-border bg-card p-4 text-card-foreground">
  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Estimate your delivery cost</summary><div>
  <p className="mb-3 mt-1 text-xs leading-5 text-muted-foreground">Base charge plus the one-way driving distance to your postcode.</p>
  <PostcodeField label="Delivery postcode" value={postcode} onChange={change} helpText="Enter the postcode where you would like the car delivered."/>
  <Button type="button" variant="outline" className="mt-3 w-full" disabled={busy||!postcode.trim()} onClick={()=>void calculate()}>{busy?'Calculating road miles…':'Calculate delivery'}</Button>
  {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  {estimate && <div role="status" aria-live="polite" className="mt-4 border-t border-border pt-3">
   <p className="text-xs text-muted-foreground">Delivery to {estimate.postcode} · {estimate.roadMiles.toLocaleString('en-GB',{minimumFractionDigits:1,maximumFractionDigits:1})} road miles</p>
   <strong className="mt-1 block font-display text-2xl font-semibold">{pounds(estimate.totalPence)} <span className="font-sans text-xs font-normal text-muted-foreground">estimated delivery</span></strong>
   <dl className="mt-3 space-y-1 text-xs"><div className="flex justify-between gap-3"><dt>Base charge</dt><dd>{pounds(estimate.basePricePence)}</dd></div><div className="flex justify-between gap-3"><dt>{estimate.roadMiles.toLocaleString('en-GB')} miles × {pounds(estimate.pricePerMilePence)}</dt><dd>{pounds(estimate.mileageChargePence)}</dd></div></dl>
   <p className="mt-3 text-xs leading-5 text-muted-foreground">Estimated from postcode locations using a driving route. The dealership will confirm the final price and delivery availability. Nothing is booked or charged.</p>
  </div>}
  <p className="mt-3 text-[11px] leading-4 text-muted-foreground">Road routing by <a href="https://openrouteservice.org/" target="_blank" rel="noopener noreferrer" className="underline">openrouteservice</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap contributors</a></p>
 </div></details>;
}
