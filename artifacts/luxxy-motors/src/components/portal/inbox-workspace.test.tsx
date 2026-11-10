import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { Enquiry } from '@workspace/api-client-react';
import type { InboxEnquiry } from '@/lib/enquiry-reply-attention';
import type { Car } from '@/lib/stock-context';
import type { EnquiryRecordActions } from './enquiry-record-browser';

const state = vi.hoisted(() => ({ customerCase: vi.fn() }));
vi.mock('./enquiry-customer-case', () => ({
  EnquiryCustomerCase: (props: { entry: Enquiry; entries: Enquiry[]; car?: Car; actions: EnquiryRecordActions }) => {
    const [draft, setDraft] = useState('');
    state.customerCase(props);
    return <section aria-label={`Selected case ${props.entry.id}`}>
      <p>Selected customer: {props.entry.customerName}</p>
      <p>Selected vehicle: {props.car?.id || 'unavailable'}</p>
      <label>Case draft<textarea value={draft} onChange={event=>setDraft(event.target.value)}/></label>
      <button onClick={() => props.actions.onEmail?.(props.entry)}>Reply to {props.entry.customerName}</button>
      <button onClick={() => props.actions.onDoneNext?.(props.entry)}>Done & next</button>
    </section>;
  },
}));

import { InboxWorkspace } from './inbox-workspace';

const now = '2026-11-02T12:00:00Z';
const record = (id: string, changes: Partial<InboxEnquiry> = {}): InboxEnquiry => ({
  id, reference: `ENQ-${id}`, dealerId: 'dealer-one', customerName: id,
  type: 'general', status: 'new', source: 'website',
  vehicleId: `${id}-car`, vehicleTitle: `${id} Audi A5`, vehicleRegistration: 'MW62 VLP',
  phone: '07700900123', email: `${id}@example.test`, message: `Question from ${id}`,
  appointmentAt: null, appointmentCancelledAt: null, events: [],
  createdAt: '2026-11-02T11:30:00Z', updatedAt: '2026-11-02T11:30:00Z', ...changes,
} as Enquiry);
const actions = (): EnquiryRecordActions => ({
  onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(),
  onBook: vi.fn(), onVehicle: vi.fn(), onEmail: vi.fn(),
});
type Props = React.ComponentProps<typeof InboxWorkspace>;

function show(options: Partial<Props> = {}) {
  const onSelect = vi.fn(), onBack = vi.fn((): boolean | void => undefined);
  const onRefresh = vi.fn(), onNewEnquiry = vi.fn();
  const caseActions = actions();
  function Harness() {
    const [selected, setSelected] = useState(options.selectedId ?? null);
    return <InboxWorkspace entries={[]} cars={[]} actions={caseActions}
      onRefresh={onRefresh} onNewEnquiry={onNewEnquiry} {...options} selectedId={selected}
      onSelect={id => { onSelect(id); options.onSelect?.(id); setSelected(id); }}
      onBack={() => {
        onBack();
        const permitted = options.onBack?.();
        if (permitted !== false) setSelected(null);
        return permitted;
      }}/>
  }
  const view=render(<Harness/>);
  return { onSelect, onBack, onRefresh, onNewEnquiry, caseActions,
    update:(patch:Partial<Props>)=>{options={...options,...patch};view.rerender(<Harness/>);},
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  state.customerCase.mockClear();
  Object.defineProperty(window, 'matchMedia', { configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});
afterEach(() => vi.useRealTimers());

describe('the rebuilt Inbox queue', () => {
  it('keeps automated cases in Enquiries and offers focused AI and Archive views',()=>{
    const manual=record('Manual',{source:'cazoo'}), automated=record('AI customer',{source:'cazoo',aiProvider:'cazoo',aiDraftStatus:'ready'});
    const archived=record('Archived customer',{archivedAt:'2026-11-01T10:00:00Z',archiveDeleteAt:'2026-12-01T10:00:00Z'});
    show({entries:[manual,automated,archived]});
    expect(screen.getByRole('tab',{name:'Enquiries'})).toHaveAttribute('aria-selected','true');
    expect(screen.getByTestId('enquiry-Manual')).toBeVisible();
    expect(screen.getByTestId('enquiry-AI customer')).toBeVisible();
    fireEvent.click(screen.getByRole('tab',{name:'AI enquiries'}));
    expect(screen.getByTestId('enquiry-AI customer')).toBeVisible();
    expect(screen.getByText('Draft ready')).toBeVisible();
    expect(screen.queryByTestId('enquiry-Manual')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab',{name:'Archive'}));
    expect(screen.getByTestId('enquiry-Archived customer')).toBeVisible();
    expect(screen.queryByRole('group',{name:'Filter conversations'})).not.toBeInTheDocument();
    expect(screen.getByText('Recover for 30 days. Linked business records are protected.')).toBeVisible();
  });
  it('opens an AI-assisted deep link in the main queue and protects an unsaved reply when tabs change',()=>{
    show({entries:[record('AI customer',{source:'cazoo',aiProvider:'cazoo',aiDraftStatus:'ready'}),record('Manual')],selectedId:'AI customer',onBack:()=>false});
    expect(screen.getByRole('tab',{name:'Enquiries'})).toHaveAttribute('aria-selected','true');
    fireEvent.click(screen.getByRole('tab',{name:'Archive'}));
    expect(screen.getByRole('tab',{name:'Enquiries'})).toHaveAttribute('aria-selected','true');
    expect(screen.getByRole('region',{name:'Selected case AI customer'})).toBeVisible();
  });
  it('keeps website, Cazoo and pending bookings together, with accurate colours and elapsed times', () => {
    const website = record('Alex');
    const cazoo = record('Ellie', { source: 'cazoo', latestReplyText: 'Is it still available?' });
    const pending = record('Tom', { type: 'viewing', appointmentAt: '2026-11-03T10:00:00Z', appointmentStatus: 'pending' });
    const booked = record('Sam', { type: 'viewing', appointmentAt: '2026-11-03T11:00:00Z', appointmentStatus: 'confirmed' });
    show({ entries: [website, cazoo, pending, booked] });
    expect(screen.getByRole('heading', { level: 2, name: 'Inbox' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Needs you/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('enquiry-Alex')).toBeVisible();
    expect(within(screen.getByTestId('enquiry-Ellie')).getByText('Cazoo')).toBeVisible();
    expect(within(screen.getByTestId('enquiry-Ellie')).getByText('Is it still available?')).toBeVisible();
    expect(within(screen.getByTestId('enquiry-Tom')).getByText('Needs you')).toHaveAttribute('data-tone', 'warning');
    expect(within(screen.getByTestId('enquiry-Alex')).getByText('30m ago')).toBeVisible();
    expect(screen.queryByTestId('enquiry-Sam')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Test drives/ }));
    expect(screen.queryByTestId('enquiry-Alex')).not.toBeInTheDocument();
    expect(screen.getByTestId('enquiry-Tom')).toBeVisible();
    expect(within(screen.getByTestId('enquiry-Sam')).getByText('Booked')).toHaveAttribute('data-tone', 'success');
  });

  it('switches attention filters and searches customers, number plates and incoming messages', () => {
    const active = record('Ellie', { source: 'cazoo', latestReplyText: 'Could I visit Friday?' });
    const done = record('Done customer', { status: 'closed' });
    const booked = record('Booked customer', { status: 'closed', type: 'viewing',
      appointmentAt: '2026-11-03T11:00:00Z', appointmentStatus: 'confirmed' });
    show({ entries: [active, done, booked] });
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter conversations' })).getByRole('button', { name: /^Done/ }));
    expect(screen.getByTestId('enquiry-Done customer')).toBeVisible();
    expect(screen.queryByTestId('enquiry-Booked customer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(screen.getByTestId('enquiry-Booked customer')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search enquiries' }), { target: { value: 'Friday Ellie MW62VLP' } });
    expect(screen.getByTestId('enquiry-Ellie')).toBeVisible();
    expect(screen.queryByTestId('enquiry-Done customer')).not.toBeInTheDocument();
    expect(screen.getByText('1 conversation')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search enquiries' }), { target: { value: 'No such customer' } });
    expect(screen.getByRole('heading', { name: 'No matching conversations' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show all enquiries' }));
    expect(screen.getByRole('textbox', { name: 'Search enquiries' })).toHaveValue('');
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('hands new-enquiry, refresh and tools actions through without triggering a reply', () => {
    const api = show({ entries: [record('Ellie')], tools: <button>Calendar</button> });
    expect(screen.getByRole('navigation', { name: 'Inbox tools' })).not.toBeVisible();
    fireEvent.click(screen.getByText('Tools', { selector: 'summary' }));
    expect(screen.getByRole('navigation', { name: 'Inbox tools' })).toBeVisible();
    expect(api.caseActions.onEmail).not.toHaveBeenCalled();
    expect(screen.queryByText(/AI handling|auto.?sending|AI is replying/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh inbox' }));
    expect(api.onRefresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'New enquiry' }));
    expect(api.onNewEnquiry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Reply to Ellie' }));
    expect(api.caseActions.onEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 'Ellie' }));
  });
});

describe('Inbox conversation selection', () => {
  it('opens a conversation full screen on phones and restores the list with Back to Inbox', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const api = show({ entries: [record('Ellie')] });
    const desk = screen.getByRole('region', { name: 'Inbox conversations' });
    expect(desk).toHaveAttribute('data-selected', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Open enquiry for Ellie, Ellie Audi A5' }));
    expect(api.onSelect).toHaveBeenCalledWith('Ellie');
    expect(desk).toHaveAttribute('data-selected', 'true');
    expect(screen.getByLabelText('Conversation with Ellie')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }));
    expect(api.onBack).toHaveBeenCalledOnce();
    expect(desk).toHaveAttribute('data-selected', 'false');
  });

  it('respects the unsaved-reply guard when changing filter or search', () => {
    show({ entries: [record('Ellie')], selectedId: 'Ellie', onBack: () => false });
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter conversations' })).getByRole('button', { name: /^Done/ }));
    expect(screen.getByRole('button', { name: /^Needs you/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search enquiries' }), { target: { value: 'different' } });
    expect(screen.getByRole('textbox', { name: 'Search enquiries' })).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Inbox conversations' })).toHaveAttribute('data-selected', 'true');
  });

  it('keeps an explicit deep link visible even outside the current attention filter', () => {
    show({ entries: [record('Active'), record('Closed', { status: 'closed' })], selectedId: 'Closed' });
    expect(screen.getByRole('region', { name: 'Selected case Closed' })).toBeVisible();
    expect(screen.getByText('This conversation is outside your current filter.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show in All' }));
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('enquiry-Closed')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Selected case Closed' })).toBeVisible();
  });

  it('opens a linked booking and its car, shows one queue row, and retains original switching', () => {
    const main = record('Primary', { status: 'closed' });
    const child = record('Booking', { mergedIntoId: main.id, vehicleId: 'child-car', vehicleTitle: 'Ford Focus',
      type: 'viewing', appointmentAt: '2026-11-03T11:00:00Z', appointmentStatus: 'pending' });
    const all = [main, child];
    const api = show({ entries: all, selectedId: child.id,
      cars: [{ id: 'child-car' }, { id: 'Primary-car' }] as Car[] });
    expect(screen.getByTestId('enquiry-Primary')).toBeVisible();
    expect(screen.queryByTestId('enquiry-Booking')).not.toBeInTheDocument();
    expect(screen.getByText('2 linked enquiries')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Selected case Booking' })).toHaveTextContent('Selected vehicle: child-car');
    expect(state.customerCase).toHaveBeenLastCalledWith(expect.objectContaining({ entry: child, entries: all }));
    fireEvent.click(screen.getByText('2 linked enquiries'));
    fireEvent.click(screen.getByRole('button', { name: 'Primary Audi A5 · Vehicle enquiry' }));
    expect(api.onSelect).toHaveBeenCalledWith('Primary');
    expect(screen.getByRole('region', { name: 'Selected case Primary' })).toHaveTextContent('Selected vehicle: Primary-car');
    fireEvent.click(screen.getByRole('button', { name: 'Open enquiry for Primary, Primary Audi A5' }));
    expect(api.onSelect).toHaveBeenLastCalledWith('Booking');
  });

  it('reports an unavailable deep link instead of showing a different customer', () => {
    const api = show({ entries: [record('Other customer')], selectedId: 'missing', missingRequested: true });
    expect(screen.getByRole('heading', { name: 'This enquiry is unavailable' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Selected case Other customer' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Inbox' }));
    expect(api.onRefresh).toHaveBeenCalledOnce();
  });

  it('pins the implicit desktop preview while a newer urgent customer reorders the queue', () => {
    const original=record('Ellie');
    const api=show({entries:[original]});
    fireEvent.change(screen.getByRole('textbox',{name:'Case draft'}),{target:{value:'Keep my unsaved reply'}});
    const incoming=record('New customer',{pendingEmailReplies:1,updatedAt:'2026-11-02T11:59:00Z'});
    api.update({entries:[incoming,original]});
    expect(screen.getByRole('region',{name:'Selected case Ellie'})).toBeVisible();
    expect(screen.queryByRole('region',{name:'Selected case New customer'})).not.toBeInTheDocument();
    expect(screen.getByRole('textbox',{name:'Case draft'})).toHaveValue('Keep my unsaved reply');
    expect(screen.getAllByRole('button',{name:/^Open enquiry for/})[0]).toHaveAccessibleName('Open enquiry for New customer, New customer Audi A5');
    expect(api.onSelect).not.toHaveBeenCalled();
  });

  it('keeps the selected case and its unsaved draft mounted after a background update fails', () => {
    const api=show({entries:[record('Ellie')],selectedId:'Ellie'});
    fireEvent.change(screen.getByRole('textbox',{name:'Case draft'}),{target:{value:'Draft survives a connection failure'}});
    api.update({error:true});
    expect(screen.getByRole('alert')).toHaveTextContent('The latest update couldn’t be loaded. Your conversation and draft are kept.');
    expect(screen.getByRole('region',{name:'Selected case Ellie'})).toBeVisible();
    expect(screen.getByRole('textbox',{name:'Case draft'})).toHaveValue('Draft survives a connection failure');
    fireEvent.click(screen.getByRole('button',{name:'Retry update'}));
    expect(api.onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox',{name:'Case draft'})).toHaveValue('Draft survives a connection failure');
  });

  it('unmounts the discarded first conversation after an accepted Back instead of hiding its dirty editor', () => {
    show({entries:[record('Ellie')],selectedId:'Ellie'});
    fireEvent.change(screen.getByRole('textbox',{name:'Case draft'}),{target:{value:'Discard this wording'}});
    fireEvent.click(screen.getByRole('button',{name:'Back to Inbox'}));
    expect(screen.queryByRole('region',{name:'Selected case Ellie'})).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox',{name:'Case draft'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Open enquiry for Ellie, Ellie Audi A5'}));
    expect(screen.getByRole('textbox',{name:'Case draft'})).toHaveValue('');
  });
});

describe('Inbox loading and empty states', () => {
  it('shows loading without old conversations and disables refresh while refreshing', () => {
    show({ entries: [record('Old customer')], loading: true, refreshing: true });
    expect(screen.getByRole('status')).toHaveTextContent('Loading your Inbox…');
    expect(screen.queryByTestId('enquiry-Old customer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh inbox' })).toBeDisabled();
  });

  it('shows a recoverable query error rather than a misleading empty Inbox', () => {
    const api = show({ error: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Enquiries couldn’t be loaded');
    expect(screen.queryByText('You’re up to date')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry enquiries' }));
    expect(api.onRefresh).toHaveBeenCalledOnce();
  });

  it('offers All when no work needs attention, with clear guidance for a completely empty Inbox', () => {
    show();
    expect(screen.getByRole('heading', { name: 'You’re up to date' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show all enquiries' }));
    expect(screen.getByRole('heading', { name: 'Your Inbox is ready' })).toBeVisible();
    expect(screen.getByText('Website enquiries and test-drive requests will appear here.')).toBeVisible();
  });
});

 it('filters by my enquiries or unassigned while preserving complete linked cases',()=>{
  const mine=record('Mine',{assignedToId:'staff-me'}),other=record('Other',{assignedToId:'staff-other'}),unassigned=record('Unassigned');
  show({entries:[mine,other,unassigned],currentStaffId:'staff-me'});
  fireEvent.click(screen.getByText('Tools', { selector: 'summary' }));
  fireEvent.change(screen.getByRole('combobox',{name:'Enquiry owner'}),{target:{value:'mine'}});
  expect(screen.getByTestId('enquiry-Mine')).toBeVisible();
  expect(screen.queryByTestId('enquiry-Other')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox',{name:'Enquiry owner'}),{target:{value:'unassigned'}});
  expect(screen.getByTestId('enquiry-Unassigned')).toBeVisible();
  expect(screen.queryByTestId('enquiry-Mine')).not.toBeInTheDocument();
 });
 it('advances in queue order and skips finished conversations',()=>{
  const api=show({entries:[record('Earlier'),record('Current'),record('Next'),record('Finished',{status:'closed'})],selectedId:'Current'});
  fireEvent.click(screen.getByRole('button',{name:'Done & next'}));
  expect(api.onSelect).toHaveBeenLastCalledWith('Next');
 });
 it('finishes outstanding work on a linked enquiry before moving to another customer',()=>{
  const main=record('Primary');
  const linked=record('Linked reply',{mergedIntoId:main.id,pendingEmailReplies:1});
  const api=show({entries:[main,linked,record('Other customer')],selectedId:main.id});
  fireEvent.click(screen.getByRole('button',{name:'Done & next'}));
  expect(api.onSelect).toHaveBeenLastCalledWith(linked.id);
 });
