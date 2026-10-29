import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import type { CaseActivity } from './enquiry-activity-model';
import { matchingStock, questionsToCover, replyGuidance } from './enquiry-assistance-model';
import { EnquiryAssistance } from './enquiry-assistance';
const inbound={key:'original:1',enquiryId:'1',reference:'E1',kind:'original',title:'Customer enquiry',channel:'Original enquiry',body:'Is it available? Do you take part exchange and can you deliver? I want automatic under £8,000.',at:'2026-10-29T09:00:00Z'} as CaseActivity;
const activity=(extra:Partial<CaseActivity>):CaseActivity=>({...inbound,key:'out',at:'2026-10-29T10:00:00Z',...extra});
const car=(id:string,price:number,extra:Partial<Car>={})=>({id,title:`Car ${id}`,price,transmission:'Automatic',inventoryStatus:'available',...extra}) as Car;
it('extracts the relevant questions, not the quoted earlier email',()=>{
 expect(questionsToCover(replyGuidance([{...inbound,body:'Can you deliver?\nOn Monday, Dealer wrote:\nIs there a warranty?'}])!.text)).toEqual(['Delivery']);
 expect(questionsToCover(inbound.body)).toEqual(['Availability','Part exchange','Delivery']);
});
it('waits for a recorded successful response, ignoring drafts, failed mail and private notes',()=>{
 for(const item of [activity({kind:'email',status:'Prepared · not sent'}),activity({kind:'email',status:'Failed'}),activity({kind:'internal'}),activity({kind:'call',title:'No answer'}),activity({kind:'event',title:'Customer opened WhatsApp'})]) expect(replyGuidance([inbound,item])?.waiting).toBe(true);
 for(const item of [activity({kind:'email',status:'Delivered'}),activity({kind:'email',status:'Submitted to email provider'}),activity({kind:'whatsapp'}),activity({kind:'call',title:'Information given'})]) expect(replyGuidance([inbound,item])?.waiting).toBe(false);
});
it('a newer incoming message restores waiting; unverified sender messages do not replace it',()=>{
 const reply=activity({kind:'customer-email',key:'new',at:'2026-10-29T11:00:00Z',body:'Can I visit tomorrow?'});
 expect(replyGuidance([inbound,activity({kind:'email',status:'Delivered'}),reply])?.incoming.key).toBe('new');
 expect(replyGuidance([inbound,activity({kind:'customer-email',caution:'Sender needs review'})])?.incoming.key).toBe(inbound.key);
 expect(replyGuidance([{...inbound,title:'Showroom enquiry recorded'}])).toBeNull();
});
it('only offers available stock within explicit budget and transmission, capped at three',()=>{
 const cars=[car('sold',5000,{inventoryStatus:'sold'}),car('reserved',6000,{inventoryStatus:'reserved'}),car('hidden',6000,{inventoryStatus:'hidden'}),car('manual',6000,{transmission:'Manual'}),car('dear',9000),car('1',7000),car('2',7500),car('3',8000),car('4',7900),car('unknown',0)];
 const matches=matchingStock('automatic under £8,000',cars)!;
 expect(matches.count).toBe(4);expect(matches.cars.map(x=>x.id)).toEqual(['1','2','4']);
 expect(matchingStock('manual up to 8k',cars)?.cars.map(x=>x.id)).toEqual(['manual']);
 expect(matchingStock('automatic maximum budget of £8000',cars)?.budget).toBe(8000);
});
it('does not guess when preferences are missing, negative or ambiguous',()=>{
 for(const text of ['Hello','not automatic under £8000','automatic or manual','under 8k or under 10k','under 8000 miles','under 3 years old'])expect(matchingStock(text,[])).toBeNull();
 expect(matchingStock('automatic up to 8000',[])?.count).toBe(0);
});
it('checklist is optional local UI; stock insertion is explicit and contains the correct vehicle link',()=>{
 const insert=vi.fn();render(<EnquiryAssistance items={[inbound]} cars={[car('abc',7500)]} onInsertText={insert}/>);
 expect(screen.getByText('Waiting for your reply')).toBeVisible();
 fireEvent.click(screen.getByRole('checkbox',{name:'Delivery'}));expect(screen.getByRole('checkbox',{name:'Delivery'})).toBeChecked();expect(insert).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText(/Matching available cars/));fireEvent.click(screen.getByRole('button',{name:'Add to reply'}));
 expect(insert).toHaveBeenCalledWith(expect.stringContaining('/vehicle/abc'));expect(insert).toHaveBeenCalledWith(expect.stringContaining('£7,500'));
});
it('closed and already answered enquiries do not get waiting indicators or suggestions',()=>{
 const {rerender}=render(<EnquiryAssistance items={[inbound]} closed/>);expect(screen.queryByRole('region',{name:'Reply assistance'})).toBeNull();
 rerender(<EnquiryAssistance items={[inbound,activity({kind:'whatsapp'})]}/>);expect(screen.queryByText('Waiting for your reply')).toBeNull();
});
it('does not offer an insertion action when staff cannot edit a reply',()=>{
 render(<EnquiryAssistance items={[inbound]} cars={[car('abc',7500)]}/>);expect(screen.queryByRole('button',{name:'Add to reply'})).toBeNull();
});
