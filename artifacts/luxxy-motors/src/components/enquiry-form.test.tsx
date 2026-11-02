import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import { enquiryDraftKey, readEnquiryDraft, saveEnquiryDraft } from '@/lib/enquiry-draft';
import type { Car } from '@/lib/stock-context';
import { EnquiryForm } from './enquiry-form';

const state = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn(), navigate: vi.fn(), enabled: true, servicesEnabled: true, bookingEnabled: true, pending: false, success: false, data: undefined as { customerNotificationStatus: string } | undefined }));
vi.mock('@workspace/api-client-react', () => ({ useCreateEnquiry: () => ({ mutate: state.mutate, reset: state.reset, isPending: state.pending, isSuccess: state.success, isError: false, data: state.data }) }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { ...dealerConfig, testDriveBooking: { enabled: state.bookingEnabled },
  warranty: { ...dealerConfig.warranty, enabled: state.servicesEnabled },
  delivery: { ...dealerConfig.delivery, enabled: state.servicesEnabled },
  partExchange: { ...dealerConfig.partExchange, enabled: state.servicesEnabled },
} }) }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => state.enabled }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('wouter', () => ({
  useLocation: () => ['/enquire?type=general', state.navigate],
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
  Redirect: () => null,
}));
const car = { id: 'fictional-car', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta', year: 2020, images: [], price: 6500 } as unknown as Car;
beforeEach(() => { window.sessionStorage.clear(); state.mutate.mockClear(); state.navigate.mockClear(); state.enabled = true; state.servicesEnabled = true; state.bookingEnabled = true; state.pending = false; state.success = false; state.data = undefined; state.reset.mockImplementation(() => { state.pending = false;state.success = false;state.data = undefined; }); });

it('does not promote dealer-disabled services but keeps direct customer questions available', () => {
  state.servicesEnabled = false;
  render(<EnquiryForm vehicle={car} initialType="general" />);
  expect(screen.queryByRole('link', { name: 'Part exchange valuation' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Part exchange valuation' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add a part exchange (optional)' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Book a Test Drive' })).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=fictional-car');
  expect(screen.getByTestId('form-enquiry')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Your question' })).toBeRequired();
  expect(state.mutate).not.toHaveBeenCalled();
});

it.each([false, true])('uses the same question-first enquiry and contact choices (embedded=%s)', embedded => {
  render(<EnquiryForm embedded={embedded} vehicle={car} />);
  const question = screen.getByRole('textbox', { name: 'Your question' });
  expect(question).toBeRequired();
  expect(question.compareDocumentPosition(screen.getByRole('combobox', { name: 'How should we reply?' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'How should we reply?' }), { target: { value: 'whatsapp' } });
  expect(screen.getByRole('textbox', { name: 'Mobile number' })).toBeRequired();
  expect(screen.queryByRole('textbox', { name: 'Email address' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeInTheDocument();
  expect(state.mutate).not.toHaveBeenCalled();
});

it('adds a part exchange in one action, removes it from submission, and retains answers for adding it again', () => {
  render(<EnquiryForm vehicle={car} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add a part exchange (optional)' }));
  expect(screen.getByTestId('enquiry-part-exchange-details')).toBeVisible();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Your car’s UK registration number' }), { target: { value: 'AB12 CDE' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Current mileage (miles)' }), { target: { value: '20000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove part exchange' }));
  expect(screen.queryByTestId('enquiry-part-exchange-details')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Your question' })).toBeRequired();
  fireEvent.change(screen.getByTestId('textarea-enquiry-message'), { target: { value: 'Is it available?' } });
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Fictional Buyer' } });
  fireEvent.change(screen.getByTestId('input-customer-email'), { target: { value: 'fictional@example.test' } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ partExchange: null, message: 'Is it available?' }) }), expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Add a part exchange (optional)' }));
  expect(screen.getByRole('textbox', { name: 'Your car’s UK registration number' })).toHaveValue('AB12 CDE');
  expect(screen.getByRole('spinbutton', { name: 'Current mileage (miles)' })).toHaveValue(20000);
});

it('uses separate task links with matching URLs while keeping the current draft and car', () => {
  render(<EnquiryForm vehicle={car} />);
  fireEvent.change(screen.getByTestId('textarea-enquiry-message'), { target: { value: 'Can you deliver this car?' } });
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Fictional Buyer' } });
  const link = screen.getByRole('link', { name: 'Part exchange valuation' });
  expect(link).toHaveAttribute('href', '/enquire?type=part_exchange&vehicleId=fictional-car');
  fireEvent.click(link);
  expect(state.navigate).toHaveBeenCalledWith('/enquire?type=part_exchange&vehicleId=fictional-car');
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))?.message).toBe('Can you deliver this car?');
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'part_exchange'))?.customerName).toBe('Fictional Buyer');
  expect(state.mutate).not.toHaveBeenCalled();
});

it('does not overwrite an existing unfinished task while navigating to it', () => {
  saveEnquiryDraft(enquiryDraftKey(car.id, 'part_exchange'), { customerName: 'Earlier Buyer', email: '', phone: '', preferredContact: 'email', message: 'Earlier delivery question', hasPartExchange: false, exchange: { registration: '', mileage: '', notes: '' } });
  render(<EnquiryForm vehicle={car} />);
  fireEvent.change(screen.getByTestId('textarea-enquiry-message'), { target: { value: 'Current question' } });
  fireEvent.click(screen.getByRole('link', { name: 'Part exchange valuation' }));
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'part_exchange'))?.message).toBe('Earlier delivery question');
});

it('restores the same WhatsApp contact choice on the inline form without dropping contact details', () => {
  saveEnquiryDraft(enquiryDraftKey(car.id, 'general'), { customerName: 'Fictional Buyer', email: 'fictional@example.test', phone: '+447700900123', preferredContact: 'whatsapp', message: 'Is it available?', hasPartExchange: false, exchange: { registration: '', mileage: '', notes: '' } });
  render(<EnquiryForm embedded vehicle={car} />);
  expect(screen.getByRole('combobox', { name: 'How should we reply?' })).toHaveValue('whatsapp');
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ preferredContact: 'whatsapp', phone: '+447700900123', email: 'fictional@example.test', vehicleId: car.id }) }), expect.anything());
});

it('keeps the original question in its draft when starting a booking instead of silently submitting it as a booking note', () => {
  render(<EnquiryForm vehicle={car} />);
  fireEvent.change(screen.getByTestId('textarea-enquiry-message'), { target: { value: 'Original warranty question' } });
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Fictional Buyer' } });
  fireEvent.click(screen.getByRole('link', { name: 'Book a Test Drive' }));
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))?.message).toBe('Original warranty question');
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'viewing'))).toMatchObject({ message: '', customerName: 'Fictional Buyer' });
  expect(state.mutate).not.toHaveBeenCalled();
});

it('removes the booking topic when the dealership turns online booking off',()=>{
 state.bookingEnabled=false;render(<EnquiryForm vehicle={car}/>);
 expect(screen.queryByRole('link',{name:'Book a Test Drive'})).not.toBeInTheDocument();
 expect(screen.getByTestId('form-enquiry')).toBeInTheDocument();
});

it('adds optional vehicle questions without overwriting a draft or sending it', () => {
 render(<EnquiryForm vehicle={car} embedded initialMessage="I can visit on Saturday." />);
 const input = screen.getByRole('textbox', { name: 'Your question' });
 fireEvent.click(screen.getByRole('button', { name: 'Availability' }));
 expect(input).toHaveValue('I can visit on Saturday.\n\nIs this car still available?');
 fireEvent.click(screen.getByRole('button', { name: 'Availability' }));
 expect(input).toHaveValue('I can visit on Saturday.\n\nIs this car still available?');
 expect(input).toHaveFocus();
 expect(state.mutate).not.toHaveBeenCalled();
});
it('removes delivery and part-exchange prompts when the dealership disables them', () => {
 state.servicesEnabled = false;
 render(<EnquiryForm vehicle={car} embedded />);
 const prompts = screen.getByRole('group', { name: 'Quick questions' });
 expect(prompts).toHaveTextContent('Availability');
 expect(prompts).not.toHaveTextContent('Delivery');
 expect(prompts).not.toHaveTextContent('Part exchange');
 expect(state.mutate).not.toHaveBeenCalled();
});

const savedQuestion = (message: string, name = 'Earlier Buyer') => ({ customerName: name, email: 'earlier@example.test', phone: '07700900123', preferredContact: 'email' as const, message, hasPartExchange: false, exchange: { registration: '', mileage: '', notes: '' } });

it('appends a first-render handoff after restoring the draft and preserves its contact details', () => {
  saveEnquiryDraft(enquiryDraftKey(car.id, 'general'), savedQuestion('I can visit on Saturday.'));
  render(<EnquiryForm vehicle={car} embedded messageRequest={{ id: 1, text: '  Can I see the boot?  ' }} />);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('I can visit on Saturday.\n\nCan I see the boot?');
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Earlier Buyer');
  expect(screen.getByTestId('input-customer-email')).toHaveValue('earlier@example.test');
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))?.message).toBe('I can visit on Saturday.\n\nCan I see the boot?');
  expect(state.mutate).not.toHaveBeenCalled();
});

it('handles each request once while retaining typing and later requests', () => {
  const { rerender } = render(<EnquiryForm vehicle={car} embedded />);
  const input = screen.getByTestId('textarea-enquiry-message');
  fireEvent.change(input, { target: { value: 'My original question.' } });
  rerender(<EnquiryForm vehicle={car} embedded messageRequest={{ id: 1, text: 'First request' }} />);
  rerender(<EnquiryForm vehicle={car} embedded messageRequest={{ id: 1, text: 'A changed duplicate ID' }} />);
  expect(input).toHaveValue('My original question.\n\nFirst request');
  fireEvent.change(input, { target: { value: 'My edited question.\n\nFirst request' } });
  rerender(<EnquiryForm vehicle={car} embedded messageRequest={{ id: 2, text: 'Second request' }} />);
  expect(input).toHaveValue('My edited question.\n\nFirst request\n\nSecond request');
  expect(state.mutate).not.toHaveBeenCalled();
});

it('does not duplicate a previously prepared photo request when the same vehicle draft is remounted', () => {
  const request = { id: 4, text: 'Could you please send photos of:\n• The boot\n\nAdditional detail: Seats folded.' };
  const first = render(<EnquiryForm vehicle={car} embedded initialMessage="My earlier question." messageRequest={request} />);
  const expected = `My earlier question.\n\n${request.text}`;
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue(expected);
  first.unmount();
  render(<EnquiryForm vehicle={car} embedded messageRequest={request} />);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue(expected);
  expect(state.mutate).not.toHaveBeenCalled();
});

it('preserves an oversize request intact and requires explicit resolution before any submit', () => {
  const original = 'A'.repeat(1990), request = 'Please send a photograph of the rear seats.';
  saveEnquiryDraft(enquiryDraftKey(car.id, 'general'), savedQuestion(original));
  render(<EnquiryForm vehicle={car} embedded messageRequest={{ id: 3, text: request }} />);
  const input = screen.getByTestId('textarea-enquiry-message');
  expect(input).toHaveValue(original);
  expect(screen.getByRole('region', { name: 'Requests to add to your enquiry' })).toHaveTextContent(request);
  expect(screen.getByRole('alert')).toHaveTextContent('Your draft has not changed');
  expect(screen.getByRole('button', { name: 'Add request' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeDisabled();
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate).not.toHaveBeenCalled();
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))?.message).toBe(original);
  fireEvent.change(input, { target: { value: 'My shorter original question.' } });
  expect(screen.getByRole('button', { name: 'Add request' })).toBeEnabled();
  expect(input).toHaveValue('My shorter original question.');
  fireEvent.click(screen.getByRole('button', { name: 'Add request' }));
  expect(input).toHaveValue(`My shorter original question.\n\n${request}`);
  expect(screen.queryByRole('region', { name: 'Requests to add to your enquiry' })).not.toBeInTheDocument();
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate).toHaveBeenCalledOnce();
  expect(state.mutate.mock.calls[0][0].data.message).toBe(`My shorter original question.\n\n${request}`);
});

it('lets the customer remove a pending request without changing the original draft', () => {
  const original = 'A'.repeat(2000);
  render(<EnquiryForm vehicle={car} embedded initialMessage={original} messageRequest={{ id: 5, text: 'Another question' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove request' }));
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue(original);
  expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeEnabled();
  expect(state.mutate).not.toHaveBeenCalled();
});

it('counts restored part-exchange details against the limit before applying a first-render request', () => {
  const original = 'A'.repeat(1900), request = 'R'.repeat(75);
  saveEnquiryDraft(enquiryDraftKey(car.id, 'general'), { ...savedQuestion(original), hasPartExchange: true, exchange: { registration: 'AB12 CDE', mileage: '20000', notes: '' } });
  render(<EnquiryForm vehicle={car} embedded messageRequest={{ id: 6, text: request }} />);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue(original);
  expect(screen.getByRole('region', { name: 'Requests to add to your enquiry' })).toHaveTextContent(request);
  expect(state.mutate).not.toHaveBeenCalled();
});

it('keeps each vehicle’s draft and handoff separate when the selected vehicle remounts', () => {
  const second = { ...car, id: 'other-fictional-car', title: 'Toyota Yaris' };
  saveEnquiryDraft(enquiryDraftKey(second.id, 'general'), savedQuestion('Question about the Toyota.', 'Second Buyer'));
  const { rerender } = render(<EnquiryForm key={car.id} vehicle={car} embedded initialMessage="Question about the Ford." messageRequest={{ id: 1, text: 'Ford photo request' }} />);
  rerender(<EnquiryForm key={second.id} vehicle={second} embedded messageRequest={{ id: 2, text: 'Toyota photo request' }} />);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('Question about the Toyota.\n\nToyota photo request');
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Second Buyer');
  rerender(<EnquiryForm key={car.id} vehicle={car} embedded />);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('Question about the Ford.\n\nFord photo request');
  expect(readEnquiryDraft(enquiryDraftKey(second.id, 'general'))?.message).toBe('Question about the Toyota.\n\nToyota photo request');
  expect(state.mutate).not.toHaveBeenCalled();
});


const fillValidEnquiry = () => {
  fireEvent.change(screen.getByTestId('textarea-enquiry-message'), { target: { value: 'Is this car available?' } });
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Example Buyer' } });
  fireEvent.change(screen.getByTestId('input-customer-email'), { target: { value: 'buyer@example.test' } });
};

it('resets an unkeyed vehicle context with no draft and never saves the previous question under the next vehicle', () => {
  const other = { ...car, id: 'different-car', title: 'Toyota Yaris' };
  const { rerender } = render(<EnquiryForm vehicle={car} />);
  fillValidEnquiry();
  fireEvent.click(screen.getByRole('button', { name: 'Add a part exchange (optional)' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Your car’s UK registration number' }), { target: { value: 'AB12 CDE' } });
  rerender(<EnquiryForm vehicle={other} />);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('');
  expect(screen.getByTestId('input-customer-name')).toHaveValue('');
  expect(screen.getByTestId('input-customer-email')).toHaveValue('');
  expect(screen.queryByTestId('enquiry-part-exchange-details')).not.toBeInTheDocument();
  expect(readEnquiryDraft(enquiryDraftKey(other.id, 'general'))).toBeNull();
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))?.message).toBe('Is this car available?');
  rerender(<EnquiryForm vehicle={car} />);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('Is this car available?');
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Example Buyer');
});

it('restores another vehicle’s existing draft without overwriting either context, even without remounting', () => {
  const other = { ...car, id: 'existing-draft-car' };
  saveEnquiryDraft(enquiryDraftKey(other.id, 'general'), { ...savedQuestion('Question for the other car.', 'Other Buyer'), preferredContact: 'phone', email: '', phone: '07700900123' });
  const { rerender } = render(<EnquiryForm vehicle={car} initialMessage="First question" />);
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'First Buyer' } });
  rerender(<EnquiryForm vehicle={other} initialMessage="First question" />);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('Question for the other car.');
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Other Buyer');
  expect(screen.getByTestId('select-preferred-contact')).toHaveValue('phone');
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))?.customerName).toBe('First Buyer');
  expect(readEnquiryDraft(enquiryDraftKey(other.id, 'general'))?.message).toBe('Question for the other car.');
  expect(state.mutate).not.toHaveBeenCalled();
});

it('shows a focused, associated inline error for a whitespace-only question and makes no request', () => {
  render(<EnquiryForm vehicle={car} />);
  fillValidEnquiry();
  const question = screen.getByTestId('textarea-enquiry-message');
  fireEvent.change(question, { target: { value: '  \n  ' } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(question).toHaveFocus();
  expect(question).toHaveAttribute('aria-invalid', 'true');
  expect(question).toHaveAccessibleDescription('Enter your question so we can help.');
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.change(question, { target: { value: 'A useful question' } });
  expect(question).toHaveAttribute('aria-invalid', 'false');
});

it('validates the trimmed customer name locally and trims valid name and question values', () => {
  render(<EnquiryForm vehicle={car} />);
  fillValidEnquiry();
  const name = screen.getByTestId('input-customer-name');
  fireEvent.change(name, { target: { value: '   ' } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(name).toHaveFocus();
  expect(name).toHaveAccessibleDescription('Please enter your name (between 2 and 120 characters).');
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: '  Example Buyer  ' } });
  fireEvent.change(screen.getByTestId('textarea-enquiry-message'), { target: { value: '  Is it available?  ' } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerName: 'Example Buyer', message: 'Is it available?' }) }), expect.anything());
});

it('validates the chosen reply details and lets the customer explicitly remove an invalid optional number', () => {
  render(<EnquiryForm vehicle={car} />);
  fillValidEnquiry();
  const email = screen.getByTestId('input-customer-email');
  fireEvent.change(email, { target: { value: 'invalid-address' } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(email).toHaveFocus();
  expect(email).toHaveAttribute('aria-invalid', 'true');
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.change(email, { target: { value: 'buyer@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add a phone number (optional)' }));
  fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: 'not-a-number' } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(screen.getByTestId('input-customer-phone')).toHaveFocus();
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove optional phone number' }));
  expect(screen.queryByTestId('input-customer-phone')).not.toBeInTheDocument();
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate.mock.calls[0][0].data).toMatchObject({ phone: null, email: 'buyer@example.test', preferredContact: 'email' });
});

it.each(['phone', 'whatsapp'])('requires only a usable number for %s and allows removing optional email', preferredContact => {
  render(<EnquiryForm vehicle={car} />);
  fireEvent.change(screen.getByTestId('textarea-enquiry-message'), { target: { value: 'Can you contact me?' } });
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Example Buyer' } });
  fireEvent.change(screen.getByTestId('select-preferred-contact'), { target: { value: preferredContact } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(screen.getByTestId('input-customer-phone')).toHaveFocus();
  expect(screen.getByTestId('input-customer-phone')).toHaveAttribute('aria-invalid', 'true');
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: '+44 7700 900123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add an email address (optional)' }));
  fireEvent.change(screen.getByTestId('input-customer-email'), { target: { value: 'unfinished@' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove optional email address' }));
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate.mock.calls[0][0].data).toMatchObject({ phone: '+447700900123', email: null, preferredContact });
});

it('freezes editable fields, navigation and message handoffs while a request is pending', () => {
  const changeCar = vi.fn();
  const view = render(<EnquiryForm vehicle={car} onChangeCar={changeCar} />);
  fillValidEnquiry();
  fireEvent.click(screen.getByRole('button', { name: 'Add a part exchange (optional)' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Your car’s UK registration number' }), { target: { value: 'AB12 CDE' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Current mileage (miles)' }), { target: { value: '20000' } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate).toHaveBeenCalledOnce();
  state.pending = true;
  view.rerender(<EnquiryForm vehicle={car} onChangeCar={changeCar} messageRequest={{ id: 500, text: 'New request during send' }} />);
  expect(screen.getByTestId('form-enquiry')).toHaveAttribute('aria-busy', 'true');
  for (const testId of ['textarea-enquiry-message', 'input-customer-name', 'input-customer-email', 'select-preferred-contact']) expect(screen.getByTestId(testId)).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Your car’s UK registration number' })).toBeDisabled();
  fireEvent.click(screen.getByRole('link', { name: 'Change car' }));
  fireEvent.click(screen.getByRole('link', { name: 'Part exchange valuation' }));
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(changeCar).not.toHaveBeenCalled();
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.mutate).toHaveBeenCalledOnce();
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('Is this car available?');
});

it('keeps a restored disabled part exchange out of the form and payload without deleting its raw draft', () => {
  state.servicesEnabled = false;
  saveEnquiryDraft(enquiryDraftKey(car.id, 'general'), { ...savedQuestion('Is it available?'), hasPartExchange: true, exchange: { registration: 'AB12 CDE', mileage: '20000', notes: 'Existing exchange notes' } });
  render(<EnquiryForm vehicle={car} />);
  expect(screen.queryByTestId('enquiry-part-exchange-details')).not.toBeInTheDocument();
  expect(screen.getByTestId('textarea-enquiry-message')).toBeRequired();
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))?.exchange.registration).toBe('AB12 CDE');
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  expect(state.mutate.mock.calls[0][0].data).toMatchObject({ message: 'Is it available?', partExchange: null });
});

it('treats quick questions as ordinary add buttons and never replaces the existing question', () => {
  render(<EnquiryForm vehicle={car} initialMessage="My existing question." />);
  const add = screen.getByRole('button', { name: 'Availability' });
  expect(add).not.toHaveAttribute('aria-pressed');
  fireEvent.click(add);
  expect(add).toHaveAttribute('data-selected', 'true');
  fireEvent.click(add);
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('My existing question.\n\nIs this car still available?');
});

it('confirms the chosen reply method with optional email and starts another enquiry with an empty question and exchange', () => {
  const view = render(<EnquiryForm vehicle={car} />);
  fillValidEnquiry();
  fireEvent.change(screen.getByTestId('select-preferred-contact'), { target: { value: 'phone' } });
  fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: '07700900123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add a part exchange (optional)' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Your car’s UK registration number' }), { target: { value: 'AB12 CDE' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Current mileage (miles)' }), { target: { value: '20000' } });
  fireEvent.submit(screen.getByTestId('form-enquiry'));
  const onSuccess = state.mutate.mock.calls[0][1].onSuccess;
  act(() => { state.data = { customerNotificationStatus: 'sent' };state.success = true;onSuccess(); });
  view.rerender(<EnquiryForm vehicle={car} />);
  expect(screen.getByTestId('status-enquiry-success')).toHaveTextContent('We’ll reply by phone');
  expect(screen.getByTestId('status-enquiry-success')).toHaveTextContent('We sent your enquiry details to buyer@example.test.');
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Send another enquiry' }));
  expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('');
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Example Buyer');
  expect(screen.getByTestId('input-customer-phone')).toHaveValue('07700900123');
  expect(screen.getByTestId('select-preferred-contact')).toHaveValue('phone');
  expect(screen.queryByTestId('enquiry-part-exchange-details')).not.toBeInTheDocument();
  expect(readEnquiryDraft(enquiryDraftKey(car.id, 'general'))).toMatchObject({ message: '', hasPartExchange: false, exchange: { registration: '', mileage: '', notes: '' } });
});
