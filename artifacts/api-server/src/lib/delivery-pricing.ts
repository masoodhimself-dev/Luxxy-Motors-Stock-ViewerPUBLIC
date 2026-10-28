/** Integer-pence arithmetic; one decimal mile is both displayed and priced. */
const money=/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/;
export type DeliveryPricing={enabled:boolean;basePrice:string;pricePerMile:string};
export function parseDeliveryPricing(value:unknown):DeliveryPricing|null{
 if(!value || typeof value!=='object')return null;const v=value as Record<string,unknown>;
 return typeof v.enabled==='boolean' && typeof v.basePrice==='string' && money.test(v.basePrice) && typeof v.pricePerMile==='string' && money.test(v.pricePerMile)?v as DeliveryPricing:null;
}
function pence(value:string){const [pounds,fraction='']=value.split('.');return Number(pounds)*100+Number(fraction.padEnd(2,'0'));}
export function deliveryEstimate(pricing:DeliveryPricing,metres:number){
 if(!parseDeliveryPricing(pricing)||!Number.isFinite(metres)||metres<0||metres>10000000)throw new RangeError('Valid delivery pricing and driving distance are required.');
 const tenths=Math.round(metres/1609.344*10),basePricePence=pence(pricing.basePrice),pricePerMilePence=pence(pricing.pricePerMile),mileageChargePence=Math.round(pricePerMilePence*tenths/10);
 return {roadMiles:tenths/10,basePricePence,pricePerMilePence,mileageChargePence,totalPence:basePricePence+mileageChargePence,currency:'GBP',distanceBasis:'driving',estimated:true};
}
