import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AnchorHTMLAttributes } from 'react';
import { dealerConfig } from '@/config/dealer';
import { enquiryDraftKey, readEnquiryDraft, saveEnquiryDraft } from '@/lib/enquiry-draft';
import type { PartExchangeMotDetailsResult } from '@/lib/part-exchange-lookup';
import type { Car } from '@/lib/stock-context';
import { EnquiryForm } from './enquiry-form';

const state = vi.hoisted(() => ({
  mutate: vi.fn(), reset: vi.fn(), navigate: vi.fn(), lookup: vi.fn(), pending: false,
}));
vi.mock('@workspace/api-client-react', () => ({
  useCreateEnquiry: () => ({
    mutate: state.mutate, reset: state.reset,
    isPending: state.pending, isSuccess: false, isError: false, data: undefined,
  }),
}));
vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({ settings: {
    ...dealerConfig, partExchange: { ...dealerConfig.partExchange, enabled: true },
  } }),
}));
vi.mock('@/lib/dealer-features', () => ({
  useDealerFeatures: () => ({ enabled: () => true }),
}));
vi.mock('@/lib/part-exchange-lookup', () => ({
  lookupPartExchangeCar: (...args: unknown[]) => state.lookup(...args),
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/visitor', () => ({ getVisitorId: () => 'fictional-visitor' }));
vi.mock('wouter', () => ({
  useLocation: () => ['/enquire?type=general', state.navigate],
  Link: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
  Redirect: () => null,
}));

const selectedCar = {
  id: 'fictional-fiesta', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta',
  year: 2020, images: [], price: 6500,
} as unknown as Car;
const ownCar = (extra: Partial<PartExchangeMotDetailsResult> = {}): PartExchangeMotDetailsResult => ({
  registration: 'AB12CDE',
  vehicle: { make: 'HONDA', model: 'CIVIC', registrationDate: '2012-05-01' },
  mileage: '88000',
  mot: {
    dueDate: '2027-06-01', firstTest: false,
    lastPassedDate: '2026-06-01', lastTestDate: '2026-06-01', latestTestResult: 'PASSED',
    checkedAt: '2026-11-02T10:00:00Z',
    lastReading: { date: '2026-06-01', mileage: 85042, unit: 'MI' },
  },
  ...extra,
});
const registration = () => screen.getByRole('textbox', { name: 'Your car’s UK registration number' });
const mileage = () => screen.getByRole('spinbutton', { name: 'Current mileage (miles)' });
const notes = () => screen.getByLabelText('Anything we should know about your car?');
const question = () => screen.getByTestId('textarea-enquiry-message');
const change = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const addExchange = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add a part exchange (optional)' }));
  change(registration(), 'AB12 CDE');
};
const fillContact = () => {
  change(screen.getByTestId('input-customer-name'), 'Fictional Buyer');
  change(screen.getByTestId('input-customer-email'), 'buyer@example.test');
};
const submit = () => fireEvent.submit(screen.getByTestId('form-enquiry'));
const findCar = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Find my car' }));
  await act(async () => { await Promise.resolve(); });
};
const expectUnresolved = () => {
  expect(screen.queryByRole('spinbutton', { name: 'Current mileage (miles)' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Anything we should know about your car?')).not.toBeInTheDocument();
  expect(screen.queryByText('Honda Civic')).not.toBeInTheDocument();
  expect(screen.queryByText(/Next MOT due|Last recorded mileage|Estimated mileage/)).not.toBeInTheDocument();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  window.sessionStorage.clear();
  vi.clearAllMocks();
  state.pending = false;
  state.lookup.mockReset();
  state.lookup.mockResolvedValue(ownCar());
});
afterEach(() => vi.useRealTimers());

it.each([false, true])('starts optional part exchange with registration and explicit choices only (embedded=%s)', async embedded => {
  render(<EnquiryForm embedded={embedded} vehicle={selectedCar} />);
  addExchange();
  expect(registration()).toHaveValue('AB12 CDE');
  expect(screen.getByRole('button', { name: 'Find my car' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Enter details manually' })).toBeVisible();
  expectUnresolved();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(state.lookup).not.toHaveBeenCalled();
  expect(state.mutate).not.toHaveBeenCalled();
});

it.each([false, true])('reveals the looked-up car and editable mileage without sending an enquiry (embedded=%s)', async embedded => {
  render(<EnquiryForm embedded={embedded} vehicle={selectedCar} />);
  addExchange();
  await findCar();
  expect(state.lookup).toHaveBeenCalledOnce();
  expect(state.lookup).toHaveBeenCalledWith('AB12CDE', expect.any(AbortSignal));
  expect(screen.getByText('Honda Civic')).toBeVisible();
  expect(screen.getByText(/Next MOT due/)).toHaveTextContent('1 Jun 2027');
  expect(screen.getByText(/Last recorded mileage: 85,042 miles/)).toHaveTextContent('1 Jun 2026');
  expect(screen.getByText(/Estimated mileage/)).toHaveTextContent('88,000');
  expect(mileage()).toHaveValue(88000);
  change(mileage(), '88123');
  expect(mileage()).toHaveValue(88123);
  expect(screen.queryByText(/Estimated mileage/)).not.toBeInTheDocument();
  expect((question() as HTMLTextAreaElement).value).toContain('Honda Civic');
  expect((question() as HTMLTextAreaElement).value).toContain('Ford Fiesta');
  expect((question() as HTMLTextAreaElement).value).toMatch(/part.exchange|valu/i);
  expect(state.mutate).not.toHaveBeenCalled();
});

it('uses Enter on the registration to find the car without requiring contact details or sending an enquiry', async () => {
  render(<EnquiryForm embedded vehicle={selectedCar} />);
  addExchange();
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  fireEvent(registration(), enter);
  await act(async () => { await Promise.resolve(); });
  expect(enter.defaultPrevented).toBe(true);
  expect(state.lookup).toHaveBeenCalledOnce();
  expect(state.lookup).toHaveBeenCalledWith('AB12CDE', expect.any(AbortSignal));
  expect(screen.getByText('Honda Civic')).toBeVisible();
  expect(mileage()).toHaveValue(88000);
  expect(screen.getByTestId('input-customer-name')).toHaveValue('');
  expect(screen.getByTestId('input-customer-email')).toHaveValue('');
  expect(state.mutate).not.toHaveBeenCalled();
});

it('preserves customer wording and manually entered mileage through an explicit lookup and recheck', async () => {
  render(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Can I visit on Saturday?" />);
  addExchange();
  fireEvent.click(screen.getByRole('button', { name: 'Enter details manually' }));
  change(mileage(), '90123');
  await findCar();
  expect(mileage()).toHaveValue(90123);
  expect(question()).toHaveValue('Can I visit on Saturday?');
  expect(screen.queryByText(/Estimated mileage/)).not.toBeInTheDocument();
  change(mileage(), '90500');
  state.lookup.mockResolvedValueOnce(ownCar({ mileage: '89000' }));
  await findCar();
  expect(mileage()).toHaveValue(90500);
  expect(question()).toHaveValue('Can I visit on Saturday?');
  expect(state.lookup).toHaveBeenCalledTimes(2);
  expect(state.mutate).not.toHaveBeenCalled();
});

it.each(['change registration', 'remove part exchange'])('clears an untouched generated question when choosing to %s, even after an earlier question was cleared', async action => {
  render(<EnquiryForm embedded vehicle={selectedCar} />);
  change(question(), 'An earlier question.');
  change(question(), '');
  addExchange();
  await findCar();
  expect((question() as HTMLTextAreaElement).value).toContain('Honda Civic');
  if (action === 'change registration') change(registration(), 'XY67 ABC');
  else fireEvent.click(screen.getByRole('button', { name: 'Remove part exchange' }));
  expect(question()).toHaveValue('');
  expect(state.mutate).not.toHaveBeenCalled();
});

it('restores only registration until an explicit choice, retaining saved mileage for the matching lookup', async () => {
  saveEnquiryDraft(enquiryDraftKey(selectedCar.id, 'general'), {
    customerName: 'Earlier Buyer', email: 'earlier@example.test', phone: '',
    preferredContact: 'email', message: 'Is the Fiesta still available?', hasPartExchange: true,
    exchange: { registration: 'AB12 CDE', mileage: '91001', notes: 'Two keys, small scratch.' },
  });
  render(<EnquiryForm embedded vehicle={selectedCar} />);
  expect(registration()).toHaveValue('AB12 CDE');
  expectUnresolved();
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
  expect(state.lookup).not.toHaveBeenCalled();
  await findCar();
  expect(mileage()).toHaveValue(91001);
  expect(notes()).toHaveValue('Two keys, small scratch.');
  expect(question()).toHaveValue('Is the Fiesta still available?');
  expect(screen.queryByText(/Estimated mileage/)).not.toBeInTheDocument();
  expect(state.mutate).not.toHaveBeenCalled();
  submit();
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    vehicleId: selectedCar.id, partExchange: { registration: 'AB12 CDE', mileage: 91001, condition: null },
  }) }), expect.anything());
});

it('retains the same normalised registration but clears car-specific answers when the registration changes', async () => {
  render(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Is it available?" />);
  fillContact(); addExchange();
  await findCar();
  change(mileage(), '90123');
  change(notes(), 'Two keys, small scratch.');
  change(registration(), 'ab12cde');
  expect(screen.getByText('Honda Civic')).toBeVisible();
  expect(mileage()).toHaveValue(90123);
  expect(notes()).toHaveValue('Two keys, small scratch.');
  change(registration(), 'XY67 ABC');
  expectUnresolved();
  expect(readEnquiryDraft(enquiryDraftKey(selectedCar.id, 'general'))?.exchange).toEqual({
    registration: 'XY67 ABC', mileage: '', notes: '',
  });
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
  expect(state.lookup).toHaveBeenCalledTimes(1);
  state.lookup.mockResolvedValueOnce(ownCar({
    registration: 'XY67ABC', vehicle: { make: 'TOYOTA', model: 'AYGO', registrationDate: '2017-09-01' },
    mileage: '45000',
  }));
  await findCar();
  expect(screen.getByText('Toyota Aygo')).toBeVisible();
  expect(mileage()).toHaveValue(45000);
  expect(notes()).toHaveValue('');
  expect(question()).toHaveValue('Is it available?');
  expect(state.mutate).not.toHaveBeenCalled();
});

it('blocks a forced submission while identification is unresolved or pending and never sends on lookup completion', async () => {
  let resolveLookup!: (details: PartExchangeMotDetailsResult) => void;
  state.lookup.mockImplementationOnce(() => new Promise<PartExchangeMotDetailsResult>(resolve => { resolveLookup = resolve; }));
  render(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Is it available?" />);
  fillContact(); addExchange();
  submit();
  expect(state.lookup).not.toHaveBeenCalled();
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Find my car' }));
  expect(screen.getByRole('button', { name: 'Finding your car…' })).toBeDisabled();
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
  await act(async () => { resolveLookup(ownCar()); });
  expect(mileage()).toHaveValue(88000);
  expect(state.mutate).not.toHaveBeenCalled();
  submit();
  expect(state.mutate).toHaveBeenCalledOnce();
});

it('requires an odometer reading when identification succeeds without an estimate', async () => {
  state.lookup.mockResolvedValueOnce(ownCar({ mileage: undefined }));
  render(<EnquiryForm embedded vehicle={selectedCar} />);
  fillContact(); addExchange();
  await findCar();
  expect(screen.getByText('Honda Civic')).toBeVisible();
  expect(screen.getByText(/Please enter your odometer reading/)).toBeVisible();
  expect(mileage()).toHaveValue(null);
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
  expect(mileage()).toHaveFocus();
  change(mileage(), '87000');
  expect(state.mutate).not.toHaveBeenCalled();
  submit();
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    partExchange: { registration: 'AB12 CDE', mileage: 87000, condition: null },
  }) }), expect.anything());
});

it('aborts an in-flight recheck while the enquiry is pending and restores the previously approved details', async () => {
  const view = render(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Is it available?" />);
  fillContact(); addExchange();
  await findCar();
  let resolveRecheck!: (details: PartExchangeMotDetailsResult) => void;
  state.lookup.mockImplementationOnce(() => new Promise<PartExchangeMotDetailsResult>(resolve => { resolveRecheck = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Find my car' }));
  const recheckSignal = state.lookup.mock.calls[1][1] as AbortSignal;
  expect(recheckSignal.aborted).toBe(false);
  state.pending = true;
  view.rerender(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Is it available?" />);
  expect(recheckSignal.aborted).toBe(true);
  expect(screen.queryByRole('button', { name: 'Finding your car…' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sending enquiry…' })).toBeDisabled();
  await act(async () => { resolveRecheck(ownCar({
    vehicle: { make: 'TOYOTA', model: 'AYGO', registrationDate: '2017-09-01' }, mileage: '99000',
    mot: { ...ownCar().mot!, dueDate: '2028-01-01', lastReading: { date: '2026-10-01', mileage: 97000, unit: 'MI' } },
  })); });
  state.pending = false;
  view.rerender(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Is it available?" />);
  expect(screen.getByText('Honda Civic')).toBeVisible();
  expect(screen.queryByText('Toyota Aygo')).not.toBeInTheDocument();
  expect(screen.getByText(/Next MOT due/)).toHaveTextContent('1 Jun 2027');
  expect(screen.getByText(/Last recorded mileage/)).toHaveTextContent('85,042');
  expect(mileage()).toHaveValue(88000);
  expect(state.lookup).toHaveBeenCalledTimes(2);
  expect(state.mutate).not.toHaveBeenCalled();
  submit();
  expect(state.mutate).toHaveBeenCalledOnce();
  const data = state.mutate.mock.calls[0][0].data;
  expect(data.partExchange.mileage).toBe(88000);
  expect(data.message).toContain('Honda Civic');
  expect(data.message).not.toMatch(/Toyota Aygo|99,?000|97,?000|2028/);
});

it('keeps a failed lookup behind the gate and permits an explicit manual fallback without another request', async () => {
  state.lookup.mockRejectedValueOnce(new Error('Lookup unavailable'));
  render(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Can I part exchange my car?" />);
  fillContact(); addExchange();
  await findCar();
  expect(screen.getByText(/couldn’t find your car’s details/)).toBeVisible();
  expectUnresolved();
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enter details manually' }));
  expect(mileage()).toHaveValue(null);
  expect(notes()).toBeInTheDocument();
  change(mileage(), '0');
  expect(state.lookup).toHaveBeenCalledTimes(1);
  expect(state.mutate).not.toHaveBeenCalled();
  submit();
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    partExchange: { registration: 'AB12 CDE', mileage: 0, condition: null },
  }) }), expect.anything());
});

it.each(['', '-1', '1.5', '1000001'])('rejects invalid manual mileage %j even when native form validation is bypassed', value => {
  render(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Can I part exchange my car?" />);
  fillContact(); addExchange();
  fireEvent.click(screen.getByRole('button', { name: 'Enter details manually' }));
  change(mileage(), value);
  submit();
  expect(state.mutate).not.toHaveBeenCalled();
  expect(state.lookup).not.toHaveBeenCalled();
});

it('removes optional part exchange from the outgoing enquiry without sending anything on removal', async () => {
  render(<EnquiryForm embedded vehicle={selectedCar} initialMessage="Is this car available?" />);
  fillContact(); addExchange();
  await findCar();
  change(notes(), 'Private part-exchange note.');
  fireEvent.click(screen.getByRole('button', { name: 'Remove part exchange' }));
  expect(screen.queryByTestId('enquiry-part-exchange-details')).not.toBeInTheDocument();
  expect(state.mutate).not.toHaveBeenCalled();
  submit();
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    partExchange: null, message: 'Is this car available?',
  }) }), expect.anything());
});
