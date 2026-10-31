import type { DealerConfig } from '@/config/dealer';
import type { Car } from './stock-context';
import type { VehicleAnswer } from './vehicle-answers';
import { formatPhoneDisplay } from './utils';

type AnswerDealer = DealerConfig & { testDriveBooking?: { enabled?: boolean } };
/** Only the active dealership's public settings can supplement car-specific answers. */
export function withDealerAnswers(carAnswers: VehicleAnswer[], car: Car, dealer: AnswerDealer): VehicleAnswer[] {
  const answers = carAnswers.map(answer => ({...answer}));
  const vehicleId = encodeURIComponent(car.id);
  const enquiry = `/enquire?type=general&vehicleId=${vehicleId}`;
  const warranty = answers.find(answer => answer.id === 'warranty');
  if (warranty) {
    warranty.question = 'Does this car come with a warranty?';
    warranty.answer += '\n\nAsk our team for the full cover, cost and terms for this car.';
    if (dealer.warranty?.enabled) { warranty.href = `/warranty?vehicleId=${vehicleId}`; warranty.linkLabel = 'Warranty information'; }
  } else {
    const description = dealer.warranty?.enabled ? dealer.warranty.description?.trim() : '';
    answers.push({id:'warranty',question:'Does this car come with a warranty?',answer:description ? `${description}\n\nPlease confirm the cover, duration, cost and exclusions for this car with our team.` : 'Warranty cover hasn’t been specified for this car. Ask our team whether cover is available and to confirm its duration, cost and terms.',source:'dealer',href:dealer.warranty?.enabled ? `/warranty?vehicleId=${vehicleId}` : enquiry,linkLabel:dealer.warranty?.enabled ? 'Warranty information' : 'Ask about warranty'});
  }
  const hours = dealer.hours?.filter(row => row.days.trim() && row.times.trim());
  if (hours?.length) answers.push({id:'dealer-hours',question:'What are your opening hours?',answer:`${hours.map(row => `${row.days}: ${row.times}`).join('\n')}\n\nAll times are UK time.`,source:'dealer',href:'/contact',linkLabel:'Opening hours and visiting information'});
  const address = [dealer.address?.street,dealer.address?.city,dealer.address?.region,dealer.address?.postcode].map(value=>value?.trim()).filter(Boolean);
  if (address.length) answers.push({id:'dealer-location',question:'Where are you and how do I get there?',answer:`${dealer.identity.name}\n${address.join('\n')}`,source:'dealer',href:'/contact',linkLabel:'View contact details and directions'});
  const contact = [dealer.contact.phone?.trim() ? `Phone: ${formatPhoneDisplay(dealer.contact.phone)}` : '',dealer.contact.whatsapp?.trim() ? `WhatsApp: ${formatPhoneDisplay(dealer.contact.whatsapp)}` : '',dealer.contact.email?.trim() ? `Email: ${dealer.contact.email.trim()}` : ''].filter(Boolean);
  if (contact.length) answers.push({id:'dealer-contact',question:'How can I contact you?',answer:contact.join('\n'),source:'dealer',href:'/contact',linkLabel:'Contact the dealership'});
  if (dealer.testDriveBooking?.enabled && (!car.inventoryStatus || car.inventoryStatus === 'available')) answers.push({id:'dealer-booking',question:'How do I book a test drive?',answer:'Choose a date and an available time, then enter your contact details. Follow the booking screen’s confirmation instructions before travelling.',source:'dealer',href:`/enquire?type=viewing&vehicleId=${vehicleId}`,linkLabel:'Choose a test-drive time'});
  if (dealer.partExchange?.enabled) answers.push({id:'dealer-part-exchange',question:'Can I part-exchange my current car?',answer:`${dealer.partExchange.description?.trim() || 'Send us your current car’s registration, mileage and details for a part-exchange enquiry.'}\n\nOur team will confirm the valuation and whether we can accept your car.`,source:'dealer',href:`/enquire?type=part_exchange&vehicleId=${vehicleId}`,linkLabel:'Enter your part-exchange details'});
  const delivery = answers.find(answer=>answer.id==='delivery');
  if (dealer.delivery?.enabled) {
    const estimate = dealer.deliveryPricing?.enabled;
    const description = dealer.delivery.description?.trim();
    const extra = estimate ? 'Use the delivery estimator on this page for a road-mile estimate to your postcode. Our team will confirm the arrangements.' : 'Ask our team to confirm availability, delivery costs and arrangements for your postcode.';
    if (delivery) { delivery.answer += `\n\n${extra}`; delivery.href = estimate ? '#vehicle-delivery-heading' : enquiry; delivery.linkLabel = estimate ? 'Estimate delivery' : 'Ask about delivery'; }
    else answers.push({id:'delivery',question:'Can this car be delivered?',answer:[description,extra].filter(Boolean).join('\n\n'),source:'dealer',href:estimate ? '#vehicle-delivery-heading' : enquiry,linkLabel:estimate ? 'Estimate delivery' : 'Ask about delivery'});
  } else if (delivery) {
    delivery.answer = 'Please ask our team to confirm current delivery availability and arrangements for this car.';
  }
  return answers;
}
