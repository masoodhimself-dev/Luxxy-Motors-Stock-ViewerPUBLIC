import type { Car } from '@/lib/stock-context';
import type { CaseActivity } from './enquiry-activity-model';
import { activityTimestamp } from './enquiry-activity-model';
import { conversationExcerpt } from './conversation-message';

export function replyGuidance(items: readonly CaseActivity[]) {
 const incoming=items.filter(x=>activityTimestamp(x.at)>0 && (x.kind==='customer-email' && !x.caution || x.kind==='original' && x.title!=='Showroom enquiry recorded')).sort((a,b)=>activityTimestamp(b.at)-activityTimestamp(a.at))[0];
 if(!incoming)return null;
 const responded=items.some(x=>activityTimestamp(x.at)>=activityTimestamp(incoming.at) && (
   x.kind==='whatsapp' ||
   x.kind==='email' && ['Submitted to email provider','Delivered','Open tracking recorded','Link tracking recorded'].includes(x.status??'') ||
   x.kind==='call' && ['Information given','Test drive booked','Not interested'].includes(x.title)
 ));
 return {incoming,waiting:!responded,text:conversationExcerpt(incoming.body).text};
}
export function questionsToCover(text:string):string[]{
 const questions:string[]=[];
 if(/\b(?:available|availability|still for sale)\b/i.test(text))questions.push('Availability');
 if(/\bpart[ -]?exchange\b|\bp[\/]?x\b/i.test(text))questions.push('Part exchange');
 if(/\bdeliver(?:y|ies)?\b/i.test(text))questions.push('Delivery');
 if(/\btest[ -]?drive\b|\bview(?:ing)?\b/i.test(text))questions.push('Viewing / test drive');
 if(/\b(?:service history|mot|warranty)\b/i.test(text))questions.push('MOT / history / warranty');
 if(/\b(?:finance|monthly|deposit)\b/i.test(text))questions.push('Finance / deposit');
 return questions;
}
export function matchingStock(text:string,cars:readonly Car[]) {
 // Only explicit upper budgets and transmission preferences; never infer credit, affordability or availability.
 const budgets=[...text.matchAll(/\b(?:under|below|up to|max(?:imum)?(?: budget)?(?: of)?)\s*£?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/gi)];
 if(budgets.length>1 || /\b(?:not|no|avoid)\s+(?:an?\s+)?(?:automatic|manual)\b/i.test(text))return null;
 const raw=budgets[0];
 if(raw && /^\s*(?:miles?|km|years?|months?|cc|litres?)\b/i.test(text.slice(raw.index!+raw[0].length)))return null;
 const budget=raw?Number(raw[1].replace(/,/g,''))*(raw[2]?1000:1):null;
 const automatic=/\bautomatic\b/i.test(text),manual=/\bmanual\b/i.test(text);
 if(automatic&&manual || budget!==null&&(!Number.isFinite(budget)||budget<=0))return null;
 const transmission=automatic?'automatic':manual?'manual':null;
 if(!budget&&!transmission)return null;
 const matches=cars.filter(car=>(!car.inventoryStatus||car.inventoryStatus==='available') && car.hidden!==true && car.archived!==true && typeof car.price==='number' && car.price>0 && (!budget||car.price<=budget) && (!transmission||car.transmission?.toLowerCase().includes(transmission))).sort((a,b)=>a.price!-b.price!);
 return {budget,transmission,cars:matches.slice(0,3),count:matches.length};
}
