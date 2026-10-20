import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { stockChangeEmail } from '@/lib/stock-change-email';
import { stockChangeTasksQueryKey, type StockChangeTask } from '@/lib/stock-change-tasks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EnquiryEmailComposer, type SuggestedEmailContent } from './enquiry-email-composer';

/** Keeps a prepared update editable, and checks current stock again before review/send. */
export function StockChangeEmailComposer({ entry, taskId, onClose }: {
  entry: Pick<Enquiry, 'id' | 'customerName' | 'reference' | 'vehicleId'>;
  taskId: string;
  onClose: (result?: 'sent' | 'draft') => void;
}) {
  const { settings } = useDealerSettings();
  const cache = useQueryClient();
  const key = ['staff-stock-change-task', taskId] as const;
  const path = `/api/staff/stock-change-tasks/${encodeURIComponent(taskId)}`;
  const task = useQuery({ queryKey: key, queryFn: () => customFetch<StockChangeTask>(path), retry: false,
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 30_000 });
  const [prepared, setPrepared] = useState<{ revision: number; content: SuggestedEmailContent }>();
  const preparation = task.data ? stockChangeEmail(task.data, entry, settings.identity.name) : undefined;
  useEffect(() => {
    if (!prepared && task.isFetchedAfterMount && !task.isFetching && !task.isError && task.data && preparation?.content)
      setPrepared({ revision: task.data.revision, content: preparation.content });
  }, [prepared, task.data, task.isFetchedAfterMount, task.isFetching, task.isError, preparation]);
  async function verifyContext() {
    let latest: StockChangeTask;
    try { latest = await customFetch<StockChangeTask>(path); }
    catch { throw { status: 409, data: { error: 'The stock update could not be checked. Your draft is safe; refresh before sending.' } }; }
    cache.setQueryData(key, latest);
    void cache.invalidateQueries({ queryKey: stockChangeTasksQueryKey });
    const checked = stockChangeEmail(latest, entry, settings.identity.name);
    if (checked.error || latest.revision !== prepared?.revision)
      throw { status: 409, data: { error: checked.error || 'This stock update has changed. Your draft is kept; review the latest car details before sending.' } };
  }
  const blocked = task.isError ? 'The stock update could not be rechecked. Refresh before sending.'
    : task.isFetching ? 'Checking the latest stock update…'
    : preparation?.error || (prepared && task.data?.revision !== prepared.revision ? 'This stock update has changed. Your draft is kept; reopen it from the latest task before sending.' : undefined);
  if (prepared) return <EnquiryEmailComposer entry={entry} suggestedContent={prepared.content} sendBlockedReason={blocked} verifyContext={verifyContext} onClose={onClose} />;
  return <Dialog open onOpenChange={open => { if (!open) onClose('draft'); }}><DialogContent><DialogHeader>
    <DialogTitle>Prepare stock update</DialogTitle><DialogDescription>Check the car and customer before preparing a draft. Nothing is sent automatically.</DialogDescription>
  </DialogHeader>{task.isLoading || task.isFetching ? <p role="status">Checking the latest stock update…</p> : <p role="alert">{task.isError ? 'This stock update could not be loaded. Try again or return to Home.' : preparation?.error || 'This stock update is unavailable.'}</p>}
    {task.isError && <Button type="button" variant="outline" onClick={() => void task.refetch()}>Try again</Button>}
    <Button type="button" variant="outline" onClick={() => onClose('draft')}>Close</Button>
  </DialogContent></Dialog>;
}
