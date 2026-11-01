import { expect, it } from 'vitest';
import { appendEnquiryMessage } from './enquiry-message-handoff';

it('appends a trimmed question while preserving the original draft exactly', () => {
  expect(appendEnquiryMessage('My earlier question. ', '  Can I see the boot?  ', 2000)).toEqual({ status: 'added', message: 'My earlier question. \n\nCan I see the boot?' });
});
it('does not repeat an existing whole question or append a blank request', () => {
  expect(appendEnquiryMessage('Can I visit?\n\nCan I see the boot?', 'Can I see the boot?', 2000)).toMatchObject({ status: 'unchanged' });
  expect(appendEnquiryMessage('My draft', '   ', 2000)).toEqual({ status: 'unchanged', message: 'My draft' });
});
it('does not mistake part of an existing question for a repeated new question', () => {
  expect(appendEnquiryMessage('Please confirm whether delivery is available.', 'delivery', 2000)).toMatchObject({ status: 'added', message: 'Please confirm whether delivery is available.\n\ndelivery' });
});
it('does not duplicate a complete multi-line photo request restored in a longer draft', () => {
  const request = 'Please send photos:\n• Boot\n\nWith the seats folded.';
  for (const current of [request, `Earlier question.\n\n${request}`, `${request}\n\nLater question.`, `Earlier question.\n\n${request}\n\nLater question.`]) {
    expect(appendEnquiryMessage(current, request, 2000)).toEqual({ status: 'unchanged', message: current });
  }
});
it('retains both complete texts when an appended request exceeds the available limit', () => {
  expect(appendEnquiryMessage('Original draft', 'New question', 15)).toEqual({ status: 'too_long', message: 'Original draft', request: 'New question' });
  expect(appendEnquiryMessage('', 'Too much text', 3)).toEqual({ status: 'too_long', message: '', request: 'Too much text' });
});
