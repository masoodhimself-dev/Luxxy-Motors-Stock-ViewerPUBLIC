import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StrictMode, type Ref } from 'react';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { partExchangeDraftKey, savePartExchangeDraft, readPartExchangeDraft } from '@/lib/part-exchange-draft';
import { enquiryDraftKey, saveEnquiryDraft } from '@/lib/enquiry-draft';
import { PartExchangeForm } from './part-exchange-form';
import type { PartExchangeMotDetailsResult } from './part-exchange-mot-details';
import { clearHomepagePartExchangeLookup, prepareHomepagePartExchange, readHomepagePartExchangeLookup, readHomepagePartExchangeRegistration, retainHomepagePartExchangeLookup } from '@/lib/homepage-part-exchange';

const state = vi.hoisted(() => ({ allowed: true, whatsapp: '447700900123', lookup: vi.fn(), latest: null as null | ((value: unknown) => void), result: null as unknown }));
const mutation = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isSuccess: false, isError: false }));
vi.mock('@workspace/api-client-react', () => ({ useCreateEnquiry: () => mutation }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => state.allowed, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { ...dealerConfig, contact: { ...dealerConfig.contact, whatsapp: state.whatsapp } } }) }));
vi.mock('@/lib/visitor', () => ({ getVisitorId: () => 'fictional-visitor' }));
vi.mock('./part-exchange-mot-details', () => ({ PartExchangeMotDetails: ({ onDetails, onManualEntry, lookupButtonRef, initialResult }: { onDetails: (result: unknown) => void; onManualEntry: () => void; lookupButtonRef: Ref<HTMLButtonElement>; initialResult?: PartExchangeMotDetailsResult }) => {
  state.latest = onDetails;
  return <div><button ref={lookupButtonRef} type="button" onClick={() => { state.lookup(); if (state.result) onDetails(state.result); }}>Find my car</button><button type="button" onClick={onManualEntry}>Enter details manually</button>{initialResult?.mot?.dueDate && <p>Next MOT due: {initialResult.mot.dueDate}</p>}{initialResult?.mot?.lastReading && <p>Last recorded mileage: {initialResult.mot.lastReading.mileage}</p>}</div>;
} }));
const car = { id: 'stock-1', title: 'Ford Focus', make: 'Ford', model: 'Focus', price: 7490, year: 2019, images: [], inventoryStatus: 'available' } as unknown as Car;
const toyota = { ...car, id: 'stock-2', title: 'Toyota Yaris', make: 'Toyota', model: 'Yaris' };
const result = (): PartExchangeMotDetailsResult => ({ registration: 'AB12CDE', vehicle: { make: 'HONDA', model: 'CIVIC', registrationDate: '2012-01-01' }, mileage: '65000', mot: { dueDate: '2027-10-20', firstTest: false, lastPassedDate: '2026-10-20', lastTestDate: '2026-10-20', latestTestResult: 'PASSED', checkedAt: '2026-11-01T10:00:00Z', lastReading: { date: '2026-10-20', mileage: 64000, unit: 'MI' } } });
const messageValue = () => (screen.getByTestId('part-exchange-message-preview') as HTMLTextAreaElement).value;
const input = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } });
const next = () => fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
const find = () => { input('input-part-exchange-registration', 'AB12 CDE'); fireEvent.click(screen.getByRole('button', { name: 'Find my car' })); };
const manual = () => { input('input-part-exchange-registration', 'AB12 CDE'); fireEvent.click(screen.getByRole('button', { name: 'Enter details manually' })); input('input-part-exchange-model', 'My Honda Civic'); input('input-part-exchange-mileage', '45000'); };
const review = () => { next(); next(); };
const contacts = () => { input('input-customer-name', 'Alex Buyer'); input('input-customer-phone', '07700 900123'); };
const confirm = () => fireEvent.click(screen.getByRole('checkbox', { name: /I’ve checked/ }));
beforeEach(() => { sessionStorage.clear(); clearHomepagePartExchangeLookup(); window.history.replaceState({}, '', '/'); vi.clearAllMocks(); state.allowed = true; state.whatsapp = '447700900123'; state.result = result(); state.latest = null; mutation.isPending = false; mutation.isSuccess = false; mutation.isError = false; });

it('opens a fresh homepage lookup with vehicle, mileage and MOT already filled without checking or sending again', () => {
  prepareHomepagePartExchange('AB12CDE'); retainHomepagePartExchangeLookup(result());
  render(<PartExchangeForm stockCars={[car]} />);
  expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('AB12CDE');
  expect(screen.getByTestId('input-part-exchange-model')).toHaveValue('Honda Civic');
  expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(65000);
  expect(screen.getByText('Next MOT due: 2027-10-20')).toBeInTheDocument();
  expect(screen.getByTestId('button-part-exchange-continue')).not.toBeDisabled();
  expect(readHomepagePartExchangeRegistration()).toBeNull();
  next(); fireEvent.change(screen.getByTestId('select-part-exchange-target-vehicle'), { target: { value: car.id } }); next();
  expect(messageValue()).toContain('I have a Honda Civic (AB12CDE)');
  expect(messageValue()).toContain('interested in your Ford Focus');
  expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('retains the consumed homepage lookup through Strict Mode effect replay', () => {
  prepareHomepagePartExchange('AB12CDE'); retainHomepagePartExchangeLookup(result());
  render(<StrictMode><PartExchangeForm stockCars={[car]} /></StrictMode>);
  expect(screen.getByTestId('input-part-exchange-model')).toHaveValue('Honda Civic');
  expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(65000);
  expect(screen.getByText('Next MOT due: 2027-10-20')).toBeInTheDocument();
  expect(readHomepagePartExchangeLookup('AB12CDE')).toBeNull();
  expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('uses the fresh in-memory car instead of a stale stored plate when storage writes are blocked, preserving contacts', () => {
  savePartExchangeDraft(partExchangeDraftKey(), { details: { registration: 'CD34EFG', makeModel: 'Old car', mileage: '99000', condition: 'Good', conditionNotes: 'Old damage note', keys: '2 keys', v5: 'Yes', serviceHistory: 'Full history', name: 'Earlier Buyer', phone: '07700900123', email: 'earlier@example.test' }, vehicleId: car.id, delivery: 'website' });
  const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Storage is read-only'); });
  try {
    prepareHomepagePartExchange('AB12CDE'); retainHomepagePartExchangeLookup(result());
    render(<PartExchangeForm stockCars={[car]} />);
    expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('AB12CDE');
    expect(screen.getByTestId('input-part-exchange-model')).toHaveValue('Honda Civic');
    expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(65000);
    expect(screen.getByLabelText('Anything else about your car? (optional)')).toHaveValue('');
    next(); next();
    expect(screen.getByTestId('input-customer-name')).toHaveValue('Earlier Buyer');
    expect(screen.getByTestId('input-customer-phone')).toHaveValue('07700900123');
    expect(screen.getByTestId('input-customer-email')).toHaveValue('earlier@example.test');
    expect(messageValue()).not.toMatch(/Old car|Old damage|99,000/);
    expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).not.toHaveBeenCalled();
  } finally { blocked.mockRestore(); }
});

it('cannot reuse the consumed homepage verification after the customer changes car and revisits', () => {
  prepareHomepagePartExchange('AB12CDE'); retainHomepagePartExchangeLookup(result());
  const view = render(<PartExchangeForm stockCars={[car]} />);
  input('input-part-exchange-registration', 'CD34 EFG');
  expect(screen.queryByTestId('input-part-exchange-model')).not.toBeInTheDocument();
  view.unmount();
  render(<PartExchangeForm stockCars={[car]} />);
  expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('CD34 EFG');
  expect(screen.queryByTestId('input-part-exchange-model')).not.toBeInTheDocument();
  expect(screen.queryByText(/Next MOT due/)).not.toBeInTheDocument();
  expect(screen.queryByTestId('button-part-exchange-continue')).not.toBeInTheDocument();
  expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('allows an explicit homepage manual fallback to edit empty fields without inventing MOT verification', () => {
  prepareHomepagePartExchange('AB12CDE');
  window.history.replaceState({}, '', '/enquire?type=part_exchange&manual=true');
  render(<PartExchangeForm stockCars={[car]} />);
  expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('AB12CDE');
  expect(screen.getByTestId('input-part-exchange-model')).toHaveValue('');
  expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(null);
  expect(screen.getByTestId('button-part-exchange-continue')).toBeDisabled();
  expect(screen.queryByText(/Next MOT due|Last recorded mileage/)).not.toBeInTheDocument();
  expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('ignores a manual URL without a valid registration and leaves the form behind its normal choices', () => {
  window.history.replaceState({}, '', '/enquire?type=part_exchange&manual=true');
  render(<PartExchangeForm stockCars={[car]} />);
  expect(screen.queryByTestId('input-part-exchange-model')).not.toBeInTheDocument();
  expect(screen.queryByTestId('button-part-exchange-continue')).not.toBeInTheDocument();
  expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('does not consume or apply a general homepage lookup inside a vehicle-specific form', () => {
  prepareHomepagePartExchange('AB12CDE'); retainHomepagePartExchangeLookup(result());
  const view = render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('');
  expect(screen.queryByTestId('input-part-exchange-model')).not.toBeInTheDocument();
  expect(readHomepagePartExchangeLookup('AB12CDE')?.vehicle.make).toBe('HONDA');
  view.unmount();
  render(<PartExchangeForm stockCars={[car]} />);
  expect(screen.getByTestId('input-part-exchange-model')).toHaveValue('Honda Civic');
  expect(readHomepagePartExchangeLookup('AB12CDE')).toBeNull();
  expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('starts with only registration and explicit lookup/manual choices, with no automatic check', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Find my car' })).toBeInTheDocument();
  for (const id of ['input-part-exchange-mileage', 'input-part-exchange-model', 'input-customer-name', 'button-part-exchange-continue']) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('reveals matching vehicle details and prepares the actual stock-car enquiry after an explicit lookup', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find();
  expect(screen.getByTestId('input-part-exchange-model')).toHaveValue('Honda Civic');
  expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(65000);
  review();
  const message = screen.getByRole('textbox', { name: 'Your message' });
  expect((message as HTMLTextAreaElement).value).toContain('I have a Honda Civic (AB12 CDE)');
  expect((message as HTMLTextAreaElement).value).toContain('interested in your Ford Focus');
  expect((message as HTMLTextAreaElement).value).toContain('Estimated mileage: 65,000 miles');
  expect((message as HTMLTextAreaElement).value).toContain('Recorded MOT expiry: 20 Oct 2027');
  expect(mutation.mutate).not.toHaveBeenCalled();
});

it('retains verified MOT facts after Continue and Back without another lookup, and clears them when the registration changes', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find();
  expect(screen.getByText('Next MOT due: 2027-10-20')).toBeInTheDocument();
  next(); fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('Next MOT due: 2027-10-20')).toBeInTheDocument();
  expect(screen.getByText('Last recorded mileage: 64000')).toBeInTheDocument();
  expect(state.lookup).toHaveBeenCalledTimes(1);
  input('input-part-exchange-registration', 'CD34 EFG');
  expect(screen.queryByText(/Next MOT due/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Last recorded mileage/)).not.toBeInTheDocument();
});

it('uses Enter on initial registration for lookup, then Enter on mileage for Continue without another lookup', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  input('input-part-exchange-registration', 'AB12 CDE');
  fireEvent.submit(screen.getByTestId('form-part-exchange'));
  expect(state.lookup).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('input-part-exchange-mileage')).toBeInTheDocument();
  fireEvent.submit(screen.getByTestId('form-part-exchange'));
  expect(screen.getByTestId('select-part-exchange-target-vehicle')).toBeInTheDocument();
  expect(state.lookup).toHaveBeenCalledTimes(1); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('opens manual entry only by explicit choice and accepts a zero-mileage brief with no invented paperwork', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />); manual();
  input('input-part-exchange-mileage', '0'); review(); contacts(); confirm(); next();
  expect(state.lookup).not.toHaveBeenCalled(); expect(mutation.mutate).toHaveBeenCalledTimes(1);
  const data = mutation.mutate.mock.calls[0][0].data;
  expect(data).toMatchObject({ type: 'part_exchange', vehicleId: car.id, partExchange: { registration: 'AB12 CDE', mileage: 0, condition: null } });
  expect(data.message).toContain('Current mileage: 0 miles');
  expect(data.message).not.toMatch(/Condition:|Service history:|Estimated mileage/);
  expect(Object.keys(data).sort()).toEqual(['type','vehicleId','customerName','email','phone','preferredContact','message','appointmentAt','visitorId','partExchange'].sort());
});

it('prevents a second final submission before the mutation reports its pending state and retries only explicitly', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find(); review(); contacts(); confirm();
  const form = screen.getByTestId('form-part-exchange');
  fireEvent.submit(form); fireEvent.submit(form);
  expect(mutation.mutate).toHaveBeenCalledTimes(1);
  act(() => mutation.mutate.mock.calls[0][1].onSettled());
  expect(mutation.mutate).toHaveBeenCalledTimes(1);
  fireEvent.submit(form); expect(mutation.mutate).toHaveBeenCalledTimes(2);
});

it('immediately hides a changed registration’s old details, rejects late results and requires another explicit check', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find();
  const oldResult = state.latest!;
  input('input-part-exchange-registration', 'CD34 EFG');
  expect(screen.queryByTestId('input-part-exchange-model')).not.toBeInTheDocument();
  expect(screen.queryByTestId('button-part-exchange-continue')).not.toBeInTheDocument();
  act(() => oldResult(result()));
  expect(screen.queryByTestId('input-part-exchange-mileage')).not.toBeInTheDocument();
  expect(mutation.mutate).not.toHaveBeenCalled();
});

it('preserves manually edited model and mileage on repeat checks and removes the estimated-mileage label', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find();
  input('input-part-exchange-model', 'Honda Civic Sport'); input('input-part-exchange-mileage', '65001'); input('input-part-exchange-mileage', '65000');
  fireEvent.click(screen.getByRole('button', { name: 'Find my car' }));
  expect(screen.getByTestId('input-part-exchange-model')).toHaveValue('Honda Civic Sport');
  review();
  expect(messageValue()).toContain('Current mileage: 65,000 miles');
  expect(messageValue()).not.toContain('Estimated mileage');
});

it('preserves reserved-car enquiries, excludes sold stock and requires a choice on a general enquiry', () => {
  const stock = [car, toyota, { ...car, id: 'reserved', title: 'Reserved car', inventoryStatus: 'reserved' }, { ...car, id: 'sold', title: 'Sold car', inventoryStatus: 'sold' }];
  render(<PartExchangeForm stockCars={stock} />); find(); next();
  const select = screen.getByTestId('select-part-exchange-target-vehicle');
  expect(select).toHaveValue(''); expect(select).toHaveTextContent('Reserved car'); expect(select).not.toHaveTextContent('Sold car');
  expect(screen.getByTestId('button-part-exchange-continue')).toBeDisabled();
  fireEvent.change(select, { target: { value: 'reserved' } }); next();
  expect(messageValue()).toContain('interested in your Reserved car');
});

it('keeps customer-edited wording when the target changes and offers an explicit refresh before sending', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car, toyota]} />); find(); review();
  input('part-exchange-message-preview', 'My own wording. Can I visit on Friday?');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.change(screen.getByTestId('select-part-exchange-target-vehicle'), { target: { value: toyota.id } }); next();
  expect(screen.getByTestId('part-exchange-message-preview')).toHaveValue('My own wording. Can I visit on Friday?');
  expect(screen.getByRole('button', { name: 'Update message with latest details' })).toBeInTheDocument();
  expect(screen.getByTestId('button-part-exchange-continue')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Update message with latest details' }));
  expect(messageValue()).toContain('interested in your Toyota Yaris');
  expect(mutation.mutate).not.toHaveBeenCalled();
});

it('lets customers explicitly retain custom wording and sends exactly their reviewed text', () => {
  render(<PartExchangeForm vehicle={car} stockCars={[car, toyota]} />); find(); review();
  input('part-exchange-message-preview', 'My custom question.');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.change(screen.getByTestId('select-part-exchange-target-vehicle'), { target: { value: toyota.id } }); next();
  fireEvent.click(screen.getByRole('button', { name: 'Keep my wording' })); contacts(); confirm(); next();
  expect(mutation.mutate.mock.calls[0][0].data).toMatchObject({ vehicleId: toyota.id, message: 'My custom question.' });
});

it('restores drafts safely behind a new lookup gate and keeps legacy manual values after checking', () => {
  savePartExchangeDraft(partExchangeDraftKey(car.id), { details: { registration: 'AB12 CDE', makeModel: 'My recorded Honda', mileage: '45678', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '', name: 'Earlier Buyer', phone: '07700900123', email: '' }, vehicleId: car.id, delivery: 'website' });
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('AB12 CDE');
  expect(screen.queryByTestId('input-part-exchange-mileage')).not.toBeInTheDocument(); expect(state.lookup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Find my car' }));
  expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(45678);
  expect(screen.getByTestId('input-part-exchange-model')).toHaveValue('My recorded Honda');
  review(); expect(screen.getByTestId('input-customer-name')).toHaveValue('Earlier Buyer');
});

it('preserves an edited message across remounts without trusting a stored lookup success', () => {
  const view = render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find(); review();
  input('part-exchange-message-preview', 'Please contact me after 6 pm.'); contacts(); view.unmount();
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  expect(screen.queryByTestId('part-exchange-message-preview')).not.toBeInTheDocument(); expect(state.lookup).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Find my car' })); review();
  expect(screen.getByTestId('part-exchange-message-preview')).toHaveValue('Please contact me after 6 pm.');
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Alex Buyer');
});

it('allows a newer identified car without estimated mileage to proceed only after manual odometer entry', () => {
  state.result = { ...result(), mileage: undefined, mot: { ...result().mot!, firstTest: true, dueDate: '2028-10-20', latestTestResult: null, lastPassedDate: null, lastTestDate: null } };
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find();
  expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(null);
  expect(screen.getByTestId('button-part-exchange-continue')).toBeDisabled();
  input('input-part-exchange-mileage', '9000'); review();
  expect(messageValue()).toContain('First MOT due: 20 Oct 2028');
});

it('keeps sending manual and uses the website when WhatsApp is unavailable', () => {
  state.whatsapp = ''; const view = render(<PartExchangeForm vehicle={car} stockCars={[car]} />); manual(); review(); contacts();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument(); confirm(); next();
  expect(mutation.mutate.mock.calls[0][0].data.preferredContact).toBe('phone');
  mutation.isSuccess = true; view.rerender(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  expect(screen.queryByTestId('link-part-exchange-photos')).not.toBeInTheDocument();
});

it('opens WhatsApp only after explicit review and includes the customer’s current contacts without a website mutation', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  try { render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find(); review(); contacts();
    fireEvent.click(screen.getByRole('radio', { name: 'Send everything on WhatsApp' }));
    expect(open).not.toHaveBeenCalled(); confirm(); next();
    expect(open).toHaveBeenCalledOnce(); expect(mutation.mutate).not.toHaveBeenCalled();
    const text = new URL(String(open.mock.calls[0][0])).searchParams.get('text');
    expect(text).toContain('Honda Civic'); expect(text).toContain('Ford Focus'); expect(text).toContain('Phone: 07700 900123');
  } finally { open.mockRestore(); }
});

it('blocks a removed selected car and overlong messages without submitting', () => {
  const view = render(<PartExchangeForm vehicle={car} stockCars={[car]} />); find(); review(); contacts();
  input('part-exchange-message-preview', 'A'.repeat(2001)); confirm(); next(); expect(mutation.mutate).not.toHaveBeenCalled();
  input('part-exchange-message-preview', 'My question.');
  view.rerender(<PartExchangeForm vehicle={car} stockCars={[]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('no longer available'); expect(screen.getByTestId('button-part-exchange-continue')).toBeDisabled();
});

it('discards all unsent draft answers without sending and hides the form when policy is disabled', async () => {
  const view = render(<PartExchangeForm vehicle={car} stockCars={[car]} />); manual(); view.unmount();
  const restored = render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
  expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue(''); expect(screen.queryByTestId('input-part-exchange-model')).not.toBeInTheDocument();
  await waitFor(() => expect(readPartExchangeDraft(partExchangeDraftKey(car.id))).toBeNull());
  state.allowed = false; restored.rerender(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  expect(screen.queryByTestId('input-part-exchange-registration')).not.toBeInTheDocument(); expect(mutation.mutate).not.toHaveBeenCalled();
});

it('carries existing enquiry contacts and exchange details without bypassing the explicit gate', () => {
  saveEnquiryDraft(enquiryDraftKey(car.id, 'part_exchange'), { customerName: 'Earlier Buyer', email: 'earlier@example.test', phone: '07700900123', preferredContact: 'phone', message: 'Original enquiry message stays there.', hasPartExchange: true, exchange: { registration: 'AB12 CDE', mileage: '42000', notes: 'Two keys' } });
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  expect(screen.queryByTestId('input-part-exchange-mileage')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enter details manually' }));
  input('input-part-exchange-model', 'Honda Civic'); review();
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Earlier Buyer'); expect(screen.getByTestId('input-customer-email')).toHaveValue('earlier@example.test'); expect(mutation.mutate).not.toHaveBeenCalled();
});
