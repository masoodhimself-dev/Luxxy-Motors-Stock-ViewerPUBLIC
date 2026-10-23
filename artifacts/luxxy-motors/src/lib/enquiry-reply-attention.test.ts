import { expect, it } from 'vitest';
import type { Enquiry } from '@workspace/api-client-react';
import { applyReplyAttention } from './enquiry-reply-attention';
import { enquiryPresentation } from './enquiry-presentation';
import { enquiryGroup } from './enquiry-groups';
const entry = (id: string, extra = {}) => ({ id, customerName: id, status: 'contacted', callOutcome: 'information_given', type: 'general', phone: '07700900123', events: [], ...extra }) as Enquiry;
it('brings an explicitly received reply back to attention after an earlier response, without editing the enquiry', () => {
 const original = entry('a');
 const [pending] = applyReplyAttention([original], [{enquiryId:'a',pending:2,review:0}]);
 expect(enquiryPresentation(pending)).toMatchObject({action:'respond',state:'Customer replied',priority:-1});
 expect(original).not.toHaveProperty('pendingEmailReplies');
 expect(enquiryPresentation(applyReplyAttention([original],[])[0]).action).toBe('none');
});
it('keeps sender review separate and retains scheduled booking/follow-up fields', () => {
 const original=entry('a',{appointmentAt:'2026-11-01T10:00:00Z',followUpAt:'2026-11-02T10:00:00Z'});
 const [pending]=applyReplyAttention([original],[{enquiryId:'a',pending:1,review:1}]);
 expect(enquiryPresentation(pending)).toMatchObject({state:'Email needs review',tone:'warning'});
 expect(pending.appointmentAt).toBe(original.appointmentAt);expect(pending.followUpAt).toBe(original.followUpAt);
});
it('finds pending work on explicitly merged originals without merging shared contact details', () => {
 const entries=applyReplyAttention([entry('root'),entry('child',{mergedIntoId:'root'}),entry('other')],[{enquiryId:'child',pending:1,review:0},{enquiryId:'foreign',pending:4,review:0}]);
 const group=enquiryGroup(entries[0],entries);
 expect(group.some(e=>enquiryPresentation(e).action==='respond')).toBe(true);
 expect(group.every(e=>enquiryPresentation(e).action==='none')).toBe(false);
 expect(enquiryPresentation(entries[2]).action).toBe('none');
});

it('does not leave an already replied new enquiry in Needs reply, but a newer customer reply returns it',()=>{
 const original=entry('a',{status:'new',callOutcome:null});
 expect(enquiryPresentation(applyReplyAttention([original],[{enquiryId:'a',pending:0,review:0,responded:true}])[0]).action).toBe('none');
 expect(enquiryPresentation(applyReplyAttention([original],[{enquiryId:'a',pending:1,review:0,responded:true}])[0]).action).toBe('respond');
});
