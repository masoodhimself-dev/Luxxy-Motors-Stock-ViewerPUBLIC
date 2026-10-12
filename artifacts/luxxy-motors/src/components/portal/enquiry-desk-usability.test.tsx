import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
import { TodayDesk } from './enquiry-workspace-tools';
import { EnquiryRecordBrowser, type EnquiryRecordActions } from './enquiry-record-browser';
import { DealerDashboard } from './dealer-administration';

vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...await importOriginal<object>(),
  customFetch: vi.fn(),
  useGetStaffDirectory: () => ({ data: { currentUserId: 'staff-one', members: [] }, isError: false }),
  useUpdateEnquiryWorkspace: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useChangeStaffFollowUp: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));

function entry(id: string, extra: Partial<Enquiry> = {}) {
  return {
    id, reference: `CALL-${id}`, customerName: `Customer ${id}`, phone: '07700900123', email: `${id}@example.test`,
    status: 'new', type: 'general', vehicleTitle: 'Ford Focus', vehicleId: null, appointmentAt: null,
    assignedToId: 'staff-one', assignedToName: 'Sam Dealer', message: 'Please confirm the service history.',
    workspaceRevision: 1, followUpRevision: 1, ...extra,
  } as Enquiry;
}
function show(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
beforeEach(() => {
  vi.mocked(customFetch).mockReset();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

it('keeps every waiting customer reachable while limiting the initial Today list', () => {
  const entries = Array.from({ length: 8 }, (_, index) => entry(String(index)));
  const open = vi.fn();
  show(<TodayDesk entries={entries} onOpen={open} />);
  const group = screen.getByRole('region', { name: 'Waiting for a reply' });
  expect(within(group).getAllByRole('listitem')).toHaveLength(5);
  expect(within(group).queryByText('Customer 7')).not.toBeInTheDocument();
  fireEvent.click(within(group).getByRole('button', { name: 'Show all 8' }));
  expect(within(group).getAllByRole('listitem')).toHaveLength(8);
  fireEvent.click(within(group).getByRole('button', { name: 'Open enquiry for Customer 7, CALL-7' }));
  expect(open).toHaveBeenCalledWith(entries[7]);
  fireEvent.click(within(group).getByRole('button', { name: 'Show fewer' }));
  expect(within(group).getAllByRole('listitem')).toHaveLength(5);
});

it('passes the selected original record to the email action and keeps occasional actions available', () => {
  const first = entry('first'), selected = entry('selected');
  const email = vi.fn(), update = vi.fn();
  const actions: EnquiryRecordActions = { onEmail: email, onUpdate: update, onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook: vi.fn(), onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[first, selected]} cars={[]} selectedId={selected.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  const detail = screen.getByRole('region', { name: 'Selected enquiry: Customer selected' });
  fireEvent.click(within(detail).getByRole('button', { name: 'Email customer' }));
  expect(email).toHaveBeenCalledWith(selected);
  const more = detail.querySelector('details')!;
  expect(more).not.toHaveAttribute('open');
  fireEvent.click(within(detail).getByText('More options', { exact: true }));
  fireEvent.click(within(detail).getByRole('button', { name: 'Update enquiry' }));
  expect(update).toHaveBeenCalledWith(selected);
  expect(within(detail).getByRole('link', { name: 'Start sale' })).toHaveAttribute('href', '/portal?section=sales&enquiryId=selected');
  expect(customFetch).not.toHaveBeenCalled();
});

it('does not hide stock errors or pending booking approvals inside optional reporting', async () => {
  vi.mocked(customFetch).mockImplementation(async url => url === '/api/staff/access'
    ? { role: 'owner', permissions: [], user: { name: 'Sam Dealer' } }
    : {
      generatedAt: new Date().toISOString(), unansweredEnquiries: 2, upcomingAppointments: 1, pendingAppointments: 1,
      overdueFollowUps: 0, outstandingBalancePence: 0, salesWithBalance: 0, upcomingDeliveries: 0,
      stockCount: 8, completedSales: 2, totalEnquiries: 10, convertedEnquiries: 3, enquiryConversionPercent: 30,
      completedConversionPercent: 20, appointments: [], balances: [], deliveries: [],
      stock: { stale: true, lastSuccessfulSync: null, alerts: [{ code: 'auth_failure', severity: 'error', message: 'Stock credential rejected. Check the connection.' }] },
    } as never);
  show(<DealerDashboard />);
  expect(await screen.findByText('Stock credential rejected. Check the connection.')).toBeVisible();
  expect(screen.getByRole('link', { name: /1 booking needs approval/ })).toBeVisible();
  expect(screen.getByRole('link', { name: /Cars in stock\s*8/ })).toHaveAttribute('href', '/portal?section=inventory');
  expect(screen.getByText('More dealership details').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('link', { name: /Outstanding balance\s*£0\.00/ })).toBeVisible();
});
