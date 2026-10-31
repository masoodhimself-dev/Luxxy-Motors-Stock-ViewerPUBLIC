import { expect, it } from 'vitest';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from './stock-context';
import { withDealerAnswers } from './dealer-answers';
import { vehicleAnswers } from './vehicle-answers';
const car = {id:'honda',inventoryStatus:'available'} as Car;
const dealer = {identity:{name:'Multi Choice Motors'},contact:{phone:'02046286488',whatsapp:'+447564580875',email:'enquiries@multichoicemotors.co.uk'},address:{street:'36A Coldharbour Lane',city:'Hayes',postcode:'UB3 3EP'},hours:[{days:'Monday – Saturday',times:'10:00 – 18:00'},{days:'Sunday',times:'10:00 – 17:00'}],warranty:{enabled:true,description:'Warranty options are available on eligible vehicles.'},delivery:{enabled:true,description:'Delivery may be available.'},deliveryPricing:{enabled:true},partExchange:{enabled:true},testDriveBooking:{enabled:true}} as unknown as DealerConfig & {testDriveBooking:{enabled:boolean}};
it('answers dealer hours, address, contact and booking from the active dealer settings', () => {
 const answers = withDealerAnswers([],car,dealer);
 expect(answers.find(a=>a.id==='dealer-hours')?.answer).toContain('Sunday: 10:00 – 17:00');
 expect(answers.find(a=>a.id==='dealer-location')?.answer).toContain('UB3 3EP');
 expect(answers.find(a=>a.id==='dealer-contact')?.answer).toContain('enquiries@multichoicemotors.co.uk');
 expect(answers.find(a=>a.id==='dealer-booking')?.href).toBe('/enquire?type=viewing&vehicleId=honda');
});
it('uses the dealer warranty wording without inventing included cover or a duration', () => {
 const warranty=withDealerAnswers([],car,dealer).find(a=>a.id==='warranty')!;
 expect(warranty.answer).toContain('available on eligible vehicles');
 expect(warranty.answer).toContain('Please confirm');
 expect(warranty.answer).not.toMatch(/3.month|12.month|included|free/i);
 expect(warranty.href).toBe('/warranty?vehicleId=honda');
});
it('keeps a car-specific warranty answer first and does not duplicate the question', () => {
 const source=vehicleAnswers({...car,description:'A 6 month warranty is included.'});
 const original=JSON.stringify(source);
 const result=withDealerAnswers(source,car,dealer);
 expect(result.filter(a=>a.id==='warranty')).toHaveLength(1);
 expect(result.find(a=>a.id==='warranty')?.answer).toContain('A 6 month warranty is included.');
 expect(JSON.stringify(source)).toBe(original);
});
it('keeps missing warranty information honest', () => {
 const blank={...dealer,warranty:{...dealer.warranty!,enabled:false}};
 const answer=withDealerAnswers([],car,blank).find(a=>a.id==='warranty')!;
 expect(answer.answer).toContain('hasn’t been specified');
 expect(answer.href).not.toMatch(/warranty/);
});
it('respects disabled services and unavailable cars', () => {
 const disabled={...dealer,testDriveBooking:{enabled:false},partExchange:{...dealer.partExchange!,enabled:false},delivery:{...dealer.delivery!,enabled:false}};
 const answers=withDealerAnswers([],car,disabled);
 expect(answers.some(a=>['dealer-booking','dealer-part-exchange','delivery'].includes(a.id))).toBe(false);
 expect(withDealerAnswers([],{...car,inventoryStatus:'reserved'},dealer).some(a=>a.id==='dealer-booking')).toBe(false);
});
it('keeps delivery focused and links estimates only when enabled', () => {
 const source=vehicleAnswers({...car,description:'Nationwide delivery is available.'});
 const result=withDealerAnswers(source,car,dealer);
 expect(result.filter(a=>a.id==='delivery')).toHaveLength(1);
 expect(result.find(a=>a.id==='delivery')?.href).toBe('#vehicle-delivery-heading');
 expect(result.find(a=>a.id==='dealer-part-exchange')?.answer).toContain('whether we can accept your car');
 const noEstimator={...dealer,deliveryPricing:{...dealer.deliveryPricing!,enabled:false}};
 expect(withDealerAnswers([],car,noEstimator).find(a=>a.id==='delivery')?.href).not.toContain('#');
});
it('does not leak dealer details or retain stale settings between dealerships', () => {
 withDealerAnswers([],car,dealer);
 const other={...dealer,identity:{name:'Another dealer'},contact:{},address:undefined,hours:[]};
 const answers=withDealerAnswers([],car,other);
 expect(JSON.stringify(answers)).not.toContain('Hayes');
 expect(JSON.stringify(answers)).not.toContain('multichoicemotors.co.uk');
 expect(answers.some(a=>a.id==='dealer-hours')).toBe(false);
});
