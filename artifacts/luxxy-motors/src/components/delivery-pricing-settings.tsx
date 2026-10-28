import type {DealerDeliveryPricing} from '@workspace/api-client-react';
import {Input} from './ui/input';
export const validDeliveryMoney=(value:string)=>/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(value);
export function DeliveryPricingSettings({value,deliveryEnabled,onChange,onDeliveryEnabled}:{value?:DealerDeliveryPricing;deliveryEnabled:boolean;onChange:(value:DealerDeliveryPricing)=>void;onDeliveryEnabled:(value:boolean)=>void}){
 const pricing=value??{enabled:false,basePrice:'',pricePerMile:''};
 return <section className="admin-card space-y-4" aria-label="Delivery prices">
  <h3>Vehicle delivery</h3>
  <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={deliveryEnabled} onChange={e=>{onDeliveryEnabled(e.target.checked);if(!e.target.checked && (!validDeliveryMoney(pricing.basePrice)||!validDeliveryMoney(pricing.pricePerMile)))onChange({...pricing,enabled:false,basePrice:validDeliveryMoney(pricing.basePrice)?pricing.basePrice:'0.00',pricePerMile:validDeliveryMoney(pricing.pricePerMile)?pricing.pricePerMile:'0.00'});}} className="h-5 w-5 accent-primary"/>Offer delivery on the website</label>
  <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={deliveryEnabled && pricing.enabled} disabled={!deliveryEnabled} onChange={e=>onChange({...pricing,enabled:e.target.checked,...(!e.target.checked?{basePrice:validDeliveryMoney(pricing.basePrice)?pricing.basePrice:'0.00',pricePerMile:validDeliveryMoney(pricing.pricePerMile)?pricing.pricePerMile:'0.00'}:{})})} className="h-5 w-5 accent-primary"/>Show delivery cost calculator</label>
  <fieldset disabled={!deliveryEnabled||!pricing.enabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
   <label className="block space-y-2 text-sm font-medium">Base delivery price (£)<Input inputMode="decimal" autoComplete="off" maxLength={8} value={pricing.basePrice} onChange={e=>onChange({...pricing,basePrice:e.target.value})} placeholder="50.00"/></label>
   <label className="block space-y-2 text-sm font-medium">Price per road mile (£)<Input inputMode="decimal" autoComplete="off" maxLength={8} value={pricing.pricePerMile} onChange={e=>onChange({...pricing,pricePerMile:e.target.value})} placeholder="1.50"/></label>
  </fieldset>
  <p className="text-xs leading-5 text-muted-foreground">Estimated price = base price + one-way road miles × price per mile. Enter the customer-facing prices, including any applicable tax. These settings never add charges to a sale or invoice.</p>
  <p className="text-xs leading-5 text-muted-foreground">Road estimates need the platform’s OpenRouteService connection and a verified showroom postcode. If routing is unavailable, customers are asked to contact you for a quote.</p>
 </section>;
}
