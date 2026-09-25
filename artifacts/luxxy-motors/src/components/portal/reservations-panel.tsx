import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetLeadQueryKey,
  getGetLeadsQueryKey,
  getGetPortalWorklistQueryKey,
  getGetStockQueryKey,
  getListReservationsQueryKey,
  useCancelReservation,
  useListReservations,
  type StaffOnlineReservation,
} from '@workspace/api-client-react';
import { BookmarkCheck, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Chip, EmptyState, Panel, PanelHeader, formatDateTime } from './portal-ui';

const money = (pence: number) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: pence % 100 ? 2 : 0,
}).format(pence / 100);

function cancellationError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return 'The reservation could not be cancelled. Please try again.';
}

function ReservationRow({ reservation }: {
  reservation: StaffOnlineReservation;
}) {
  const [confirming, setConfirming] = useState(false);
  const leadId = reservation.leadId;
  const queryClient = useQueryClient();
  const cancel = useCancelReservation({ mutation: {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListReservationsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetStockQueryKey() }),
        ...(leadId ? [queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) })] : []),
        queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetPortalWorklistQueryKey() }),
      ]);
      setConfirming(false);
    },
  } });

  return (
    <li className="grid gap-4 p-4 lg:grid-cols-[1.25fr_1fr_1fr_auto] lg:items-start" data-testid={`staff-reservation-${reservation.id}`}>
      <div className="min-w-0">
        <p className="font-semibold text-primary">{reservation.vehicleTitle}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{reservation.reference}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(reservation.createdAt)}</p>
      </div>
      <div className="min-w-0 text-sm">
        <p className="font-medium text-primary">{reservation.customerName}</p>
        <a href={`tel:${reservation.phone}`} className="mt-1 block w-fit text-muted-foreground underline underline-offset-4">{reservation.phone}</a>
        <a href={`mailto:${reservation.email}`} className="mt-1 block break-all text-muted-foreground underline underline-offset-4">{reservation.email}</a>
      </div>
      <div className="min-w-0 text-sm">
        <Chip tone={reservation.status === 'reserved' ? 'primary' : 'muted'}>
          {reservation.status === 'reserved' ? 'Reserved' : 'Cancelled'}
        </Chip>
        <p className="mt-2">Deposit amount: <strong>{money(reservation.depositPence)}</strong></p>
        <p className="mt-1 text-muted-foreground">Payment simulated · {money(reservation.amountReceivedPence)} received</p>
      </div>
      <div className="flex flex-wrap gap-2 lg:flex-col">
        {reservation.status === 'reserved' && (
          <AlertDialog open={confirming} onOpenChange={(open) => {
            if (!cancel.isPending) {
              if (open) cancel.reset();
              setConfirming(open);
            }
          }}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="text-destructive">Cancel reservation</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="w-[calc(100%-2rem)] rounded-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this reservation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This releases the online reservation for {reservation.vehicleTitle}, held for {reservation.customerName}.
                  The customer record stays available. Payment was simulated, so there is no payment to refund.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {cancel.isError && <p role="alert" className="text-sm text-destructive">{cancellationError(cancel.error)}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancel.isPending}>Keep reservation</AlertDialogCancel>
                <AlertDialogAction disabled={cancel.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => {
                  event.preventDefault();
                  cancel.mutate({ id: reservation.id });
                }}>
                  {cancel.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Cancelling…</> : 'Cancel and release car'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </li>
  );
}

export function ReservationsPanel() {
  const [status, setStatus] = useState('reserved');
  const query = useListReservations({ query: { queryKey: getListReservationsQueryKey(), refetchInterval: 60_000 } });
  const reservations = (query.data?.reservations ?? []).filter((reservation) => status === 'all' || reservation.status === status);

  return (
    <Panel>
      <PanelHeader title="Online reservations" meta="Cars reserved through the website. The reservation is real; payments are currently simulated and no money has been received." action={
        <Button type="button" variant="outline" size="icon" aria-label="Refresh reservations" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
        </Button>
      } />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <label className="flex items-center gap-3 text-sm font-medium">
          Show
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)} className="w-44" aria-label="Reservation status">
            <option value="reserved">Reserved</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All reservations</option>
          </NativeSelect>
        </label>
        {!query.isLoading && !query.isError && <p className="text-sm text-muted-foreground">{reservations.length} {reservations.length === 1 ? 'reservation' : 'reservations'}</p>}
      </div>
      {query.isLoading ? (
        <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading reservations…</p>
      ) : query.isError ? (
        <div role="alert" className="p-6 text-sm">
          <p className="mb-3 text-destructive">Reservations could not be loaded.</p>
          <Button type="button" variant="outline" onClick={() => query.refetch()}>Try again</Button>
        </div>
      ) : reservations.length ? (
        <ul className="divide-y divide-border">{reservations.map((reservation) => <ReservationRow key={reservation.id} reservation={reservation} />)}</ul>
      ) : (
        <div className="p-4"><EmptyState icon={BookmarkCheck} title={status === 'cancelled' ? 'No cancelled reservations' : 'No reservations to show'} body={status === 'reserved' ? 'New online reservations will appear here with the car and customer details.' : 'Choose another status to see other reservations.'} /></div>
      )}
    </Panel>
  );
}
