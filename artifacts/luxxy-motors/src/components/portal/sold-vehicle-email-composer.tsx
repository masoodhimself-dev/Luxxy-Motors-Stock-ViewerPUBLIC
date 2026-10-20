import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { soldVehicleEmail, soldVehicleFollowUpsQueryKey, soldVehicleReviewPath, soldVehicleReviewQueryKey, type SoldVehicleFollowUpReview } from '@/lib/sold-vehicle-follow-ups';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EnquiryEmailComposer, type SuggestedEmailContent } from './enquiry-email-composer';

/** Prepares an editable message; the existing composer still requires preview and explicit Send. */
export function SoldVehicleEmailComposer({ entry, saleId, onClose }: {
  entry: Pick<Enquiry, 'id' | 'customerName' | 'reference' | 'vehicleId'>;
  saleId: string;
  onClose: (result?: 'sent' | 'draft') => void;
}) {
  const { settings } = useDealerSettings();
  const cache = useQueryClient();
  const [error, setError] = useState('');
  const key = soldVehicleReviewQueryKey(saleId);
  const path = soldVehicleReviewPath(saleId);
  const query = useQuery({ queryKey: key, queryFn: () => customFetch<SoldVehicleFollowUpReview>(path),
    staleTime: 0, retry: false, refetchOnMount: 'always', refetchInterval: 30_000, refetchOnWindowFocus: true });
  const [prepared, setPrepared] = useState<{ revision: number; content: SuggestedEmailContent }>();
  const preparation = query.data ? soldVehicleEmail(query.data, entry.id, settings.identity.name) : undefined;
  const customer = query.data?.customers.find(item => item.enquiryId === entry.id);
  useEffect(() => {
    if (!prepared && query.isFetchedAfterMount && !query.isFetching && !query.isError && preparation?.content && customer)
      setPrepared({ revision: customer.revision, content: preparation.content });
  }, [prepared, query.isFetchedAfterMount, query.isFetching, query.isError, preparation, customer]);
  async function verifyContext() {
    let latest: SoldVehicleFollowUpReview;
    try { latest = await customFetch<SoldVehicleFollowUpReview>(path); }
    catch { throw { status: 409, data: { error: 'The customer review could not be checked. Your draft is safe; refresh before sending.' } }; }
    cache.setQueryData(key, latest);
    const checked = soldVehicleEmail(latest, entry.id, settings.identity.name);
    if (latest.vehicleId !== entry.vehicleId || checked.error || latest.customers.find(item => item.enquiryId === entry.id)?.revision !== prepared?.revision)
      throw { status: 409, data: { error: checked.error || 'The booking or customer review has changed. Reopen it from Home before sending.' } };
  }
  async function close(result?: 'sent' | 'draft') {
    if (result === 'sent' && customer) {
      try {
        await customFetch(`${path}/customers/${encodeURIComponent(entry.id)}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete', expectedRevision: customer.revision, outcome: 'email' }) });
      } catch { setError('The email has been submitted, but the follow-up could not be confirmed. Check delivery in Email; the task remains on Home. Do not send it again.'); return; }
    }
    void cache.invalidateQueries({ queryKey: soldVehicleFollowUpsQueryKey });
    void cache.invalidateQueries({ queryKey: key });
    onClose(result);
  }
  if (error) return <Dialog open onOpenChange={open => { if (!open) onClose('draft'); }}><DialogContent><DialogHeader><DialogTitle>Check the follow-up</DialogTitle><DialogDescription>{error}</DialogDescription></DialogHeader><Button onClick={() => onClose('draft')}>Return to customer review</Button></DialogContent></Dialog>;
  const blocked = query.isError ? 'The customer review could not be refreshed. Try again before sending.'
    : query.isFetching ? 'Checking the latest customer review…' : preparation?.error
      || (!customer?.emailRequestId ? 'This email request could not be verified. Reopen the customer review before sending.' : undefined)
      || (prepared && customer?.revision !== prepared.revision ? 'This customer review has changed. Reopen it from Home before sending.' : undefined);
  if (prepared) return <EnquiryEmailComposer entry={entry} suggestedContent={prepared.content} verifyContext={verifyContext} sendBlockedReason={blocked} sendRequestId={customer?.emailRequestId || undefined} onClose={result => void close(result)} />;
  return <Dialog open onOpenChange={open => { if (!open) onClose('draft'); }}><DialogContent><DialogHeader><DialogTitle>Prepare customer update</DialogTitle><DialogDescription>Nothing is sent until you review and approve the email.</DialogDescription></DialogHeader>
    {query.isLoading || query.isFetching ? <p role="status">Checking the customer and booking…</p> : <p role="alert">{query.isError ? 'The customer review could not be loaded.' : preparation?.error || 'This update is unavailable.'}</p>}
    {query.isError && <Button variant="outline" onClick={() => void query.refetch()}>Try again</Button>}
    <Button variant="outline" onClick={() => onClose('draft')}>Close</Button>
  </DialogContent></Dialog>;
}
