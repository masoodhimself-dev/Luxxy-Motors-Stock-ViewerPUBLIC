import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import { enquiryDraftKey, readEnquiryDraft, saveEnquiryDraft } from '@/lib/enquiry-draft';
import type { Car } from '@/lib/stock-context';
import { EnquiryForm } from './enquiry-form';

const state = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn(), navigate: vi.fn(), enabled: true, servicesEnabled: true, bookingEnabled: true }));
vi.mock('@workspace/api-client-react', () => ({ useCreateEnquiry: () => ({ mutate: state.mutate, reset: state.reset, isPending: false, isSuccess: false, isError: false }) }));
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
beforeEach(() => { window.sessionStorage.clear(); state.mutate.mockClear(); state.navigate.mockClear(); state.enabled = true; state.servicesEnabled = true; state.bookingEnabled = true; });

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

it('uses only its isolated adapter for the customer enquiry and leaves real drafts untouched',async()=>{
 const submit=vi.fn().mockResolvedValue(undefined);
 saveEnquiryDraft(enquiryDraftKey(car.id,'general'),{customerName:'Existing',email:'old@example.test',phone:'',preferredContact:'email',message:'existing draft',hasPartExchange:false,exchange:{registration:'',mileage:'',notes:''}});
 render(<EnquiryForm vehicle={car} testMode={{customer:{name:'Copied Customer',email:'copy@example.test',phone:'07700900123'},submit}}/>);
 expect(screen.getByTestId('input-customer-name')).toHaveValue('Copied Customer');
 fireEvent.change(screen.getByTestId('input-customer-name'),{target:{value:'Edited Test Customer'}});
 fireEvent.change(screen.getByTestId('textarea-enquiry-message'),{target:{value:'Can I see this car?'}});
 fireEvent.submit(screen.getByTestId('form-enquiry'));
 await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({customerName:'Edited Test Customer',message:'Can I see this car?',visitorId:null})));
 expect(state.mutate).not.toHaveBeenCalled();
 expect(readEnquiryDraft(enquiryDraftKey(car.id,'general'))?.message).toBe('existing draft');
 expect(await screen.findByText('Test enquiry received')).toBeVisible();
});

it('blocks unsupported customer form types in test mode instead of mounting a live form',()=>{
 render(<EnquiryForm vehicle={car} initialType="part_exchange" testMode={{customer:{name:'Test Customer',email:'test@example.test',phone:''},submit:vi.fn()}}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('not available');
 expect(state.mutate).not.toHaveBeenCalled();
});
