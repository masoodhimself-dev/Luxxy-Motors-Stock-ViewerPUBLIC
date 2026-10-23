import {render,screen,within} from '@testing-library/react';
import {expect,it} from 'vitest';
import {EnquiryOriginalMessage,partExchangeMessageParts} from './enquiry-original-message';
it('shows part-exchange facts and freeform notes without losing the complete original',()=>{
 const text='Hello, I would like a part exchange.\n\nMY CURRENT CAR\nRegistration: AB12 CDE\nMake / model: VW Polo\nMileage: 38,000 miles\nDamage / faults / other details: Scratch on door\nPlease call after 4pm\n\nYOUR STOCK VEHICLE\nSkoda Superb\nAdvertised price: GBP 8,244\n\nMY CONTACT DETAILS\nName: Fictional Customer\nPhone: 07700900123\nEmail: example@example.test\n\nCan I bring it on Saturday?';
 render(<EnquiryOriginalMessage text={text}/>);
 const facts=screen.getByRole('region',{name:"Customer's part-exchange car"});
 expect(within(facts).getByText('VW Polo')).toBeVisible();
 expect(within(facts).getByText('Scratch on door')).toBeVisible();
 expect(within(facts).getByText('Please call after 4pm')).toBeVisible();
 expect(screen.getByText('Can I bring it on Saturday?')).toBeVisible();
 const original=screen.getByText('View full original enquiry').closest('details')!;
 expect(original).not.toHaveAttribute('open');
 expect(original.querySelector('p')?.textContent).toBe(text);
});
it('keeps unknown or incomplete messages unchanged',()=>{
 const text='MY CURRENT CAR\nA customer question without the full website format.';
 expect(partExchangeMessageParts(text)).toBeNull();
 const {container}=render(<EnquiryOriginalMessage text={text}/>);
 expect(container.querySelector('p')?.textContent).toBe(text);
 expect(container.querySelector('details')).toBeNull();
});
