import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SoldVehicleEmailComposer } from './sold-vehicle-email-composer';
import type { SoldVehicleFollowUpReview } from '@/lib/sold-vehicle-follow-ups';
const state = vi.hoisted(() => ({ fetch: vi.fn(), close: vi.fn(), editor: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { identity: { name: 'Luxxy Motors' } } }) }));
vi.mock('./enquiry-email-composer', () => ({ EnquiryEmailComposer: (props: any) => { state.editor(props); return <div><p>{props.suggestedContent.message}</p><button onClick={() => props.onClose('draft')}>Save draft</button><button onClick={() => props.onClose('sent')}>Explicit reviewed send</button></div>; } }));
const base: SoldVehicleFollowUpReview = { saleId: 'sale', vehicleId: 'car', vehicleTitle: 'Toyota Yaris', registration: null, imageUrl: null, sold: true, createdAt: '2026-10-20T11:00:00Z', remaining: 1, upcomingAppointments: 0,
 customers: [{ enquiryId: 'enquiry', customerName: 'Alex', email: 'alex@example.test', phone: null, preferredContact: null, kind: 'appointment', appointmentAt: '2026-10-22T10:00:00Z', appointmentRevision: 4, appointmentCancelledAt: '2026-10-20T11:00:00Z', cancelledByReview: true, status: 'pending', revision: 2, contactedAt: null, outcome: null, emailStatus: null, emailRequestId: '00000000-0000-4000-8000-000000000995', urgent: false }] };
let current: SoldVehicleFollowUpReview;
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><SoldVehicleEmailComposer saleId="sale" entry={{ id: 'enquiry', customerName: 'Alex', reference: '', vehicleId: 'car' }} onClose={state.close} /></QueryClientProvider>); }
beforeEach(() => { current = structuredClone(base); state.fetch.mockReset(); state.close.mockReset(); state.editor.mockReset(); state.fetch.mockImplementation(async () => structuredClone(current)); });
it('prepares through the existing composer without changing or sending anything', async () => {
 show(); expect(await screen.findByText(/we’ve cancelled your test drive/)).toBeVisible();
 const props = state.editor.mock.calls.at(-1)![0];
 expect(props.suggestedContent.label).toBe('Test drive cancellation');
 expect(props.sendRequestId).toBe('00000000-0000-4000-8000-000000000995');
 expect(props.initialContent).toBeUndefined();
 expect(props.verifyContext).toBeTypeOf('function');
 expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
 fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
 await waitFor(() => expect(state.close).toHaveBeenCalledWith('draft'));
 expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
it('rechecks context before review/send and blocks a changed booking without replacing the draft', async () => {
 show(); await screen.findByText(/we’ve cancelled your test drive/);
 const props = state.editor.mock.calls.at(-1)![0];
 current.customers[0].revision += 1;
 await expect(props.verifyContext()).rejects.toMatchObject({ status: 409 });
 expect(props.suggestedContent.message).toContain('Toyota Yaris');
});
it('blocks a different vehicle before sending even when the customer appears in the review', async () => {
 show(); await screen.findByText(/we’ve cancelled your test drive/);
 const props = state.editor.mock.calls.at(-1)![0]; current.vehicleId = 'different-car';
 await expect(props.verifyContext()).rejects.toMatchObject({ status: 409 });
});
it('records email follow-up only after the composer confirms an explicit send', async () => {
 show(); await screen.findByText(/we’ve cancelled your test drive/);
 fireEvent.click(screen.getByRole('button', { name: 'Explicit reviewed send' }));
 await waitFor(() => expect(state.close).toHaveBeenCalledWith('sent'));
 const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
 expect(writes).toHaveLength(1);
 expect(JSON.parse(writes[0][1].body)).toEqual({ action: 'complete', expectedRevision: 2, outcome: 'email' });
});
it('leaves unconfirmed email follow-ups on Home and warns against duplicate sending', async () => {
 state.fetch.mockImplementation(async (_path: string, options?: RequestInit) => { if(options?.method) throw { status: 409 }; return structuredClone(current); });
 show(); await screen.findByText(/we’ve cancelled your test drive/);
 fireEvent.click(screen.getByRole('button', { name: 'Explicit reviewed send' }));
 expect(await screen.findByText(/Do not send it again/)).toBeVisible();
 expect(state.close).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button', { name: 'Return to customer review' }));
 expect(state.close).toHaveBeenCalledWith('draft');
});
it('does not prepare an inaccurate cancellation if the appointment is still active', async () => {
 current.customers[0].cancelledByReview = false; current.customers[0].appointmentCancelledAt = null; show();
 expect(await screen.findByRole('alert')).toHaveTextContent('Cancel the appointment');
 expect(state.editor).not.toHaveBeenCalled();
});

// These fixture appointments are future visits; keep that independent of the wall clock.
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T12:00:00Z")); });
afterEach(() => vi.restoreAllMocks());
