import { useState } from 'react';
import type { Car } from '@/lib/stock-context';
import type { CaseActivity } from './enquiry-activity-model';
import { matchingStock, questionsToCover, replyGuidance } from './enquiry-assistance-model';
import { formatPrice } from '@/lib/utils';
import { Button } from '../ui/button';
import './enquiry-assistance.css';
export function EnquiryAssistance({items,cars=[],onInsertText,closed=false}:{items:readonly CaseActivity[];cars?:readonly Car[];onInsertText?:(text:string)=>void;closed?:boolean}){
 const guidance=replyGuidance(items);
 if(!guidance||closed||!guidance.waiting)return null;
 return <Assistance key={guidance.incoming.key} text={guidance.text} cars={cars} onInsertText={onInsertText}/>;
}
function Assistance({text,cars,onInsertText}:{text:string;cars:readonly Car[];onInsertText?: (text:string)=>void}){
 const [covered,setCovered]=useState<string[]>([]);
 const questions=questionsToCover(text),matches=matchingStock(text,cars);
 return <section className="enquiry-assistance" aria-label="Reply assistance">
  <p className="enquiry-waiting"><strong>Waiting for your reply</strong><span>Latest customer message has no recorded response.</span></p>
  {questions.length>0&&<fieldset><legend>Questions to cover</legend><p>Tick as you cover each topic. This checklist is only for this view.</p><div className="enquiry-question-checks">{questions.map(question=><label key={question}><input type="checkbox" checked={covered.includes(question)} onChange={event=>setCovered(current=>event.target.checked?[...current,question]:current.filter(x=>x!==question))}/>{question}</label>)}</div></fieldset>}
  {matches&&<details className="enquiry-stock-matches"><summary>Matching available cars <span>({matches.count})</span></summary><p>Based on {matches.transmission??'any transmission'}{matches.budget?` up to ${formatPrice(matches.budget)}`:''}. Check the customer’s other requirements before offering a car.</p>
   {!matches.cars.length&&<p>No available cars match these preferences.</p>}
   {matches.cars.map(car=><div className="enquiry-stock-match" key={car.id}><div><a href={`/vehicle/${encodeURIComponent(car.id)}`} target="_blank" rel="noopener noreferrer">{car.title||[car.make,car.model].filter(Boolean).join(' ')}</a><span>{formatPrice(car.price!)} · {car.transmission}</span></div>{onInsertText&&<Button type="button" variant="outline" size="sm" onClick={()=>onInsertText(`${car.title||[car.make,car.model].filter(Boolean).join(' ')} — ${formatPrice(car.price!)}\n${window.location.origin}/vehicle/${encodeURIComponent(car.id)}`)}>Add to reply</Button>}</div>)}
  </details>}
 </section>;
}
