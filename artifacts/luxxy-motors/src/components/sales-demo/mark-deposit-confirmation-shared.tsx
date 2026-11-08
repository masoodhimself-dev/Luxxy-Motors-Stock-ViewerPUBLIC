import { useEffect, useRef, useState } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { saleDepositConfirmationShared, type SaleWorkspaceDocument, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check } from '@/components/icons';
import { requestUuid } from '@/lib/request-uuid';

export function MarkDepositConfirmationShared({ sale, document, onSaved, disabled, onBusyChange }: {
  sale: SaleWorkspaceRecord;
  document: SaleWorkspaceDocument;
  onSaved: (sale: SaleWorkspaceRecord) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const attempt = useRef<{ revision: number; id: string } | null>(null);

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  async function markShared() {
    if (disabled || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    if (attempt.current?.revision !== sale.revision) attempt.current = { revision: sale.revision, id: requestUuid() };
    setBusy(true);
    setError('');
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(
        `/api/sale-operations/${encodeURIComponent(sale.id)}/mark-deposit-confirmation-shared`,
        {
          method: 'POST',
          body: JSON.stringify({ documentId: document.id, acknowledge: true, expectedRevision: sale.revision, requestId: attempt.current.id }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      if (result.sale?.id !== sale.id || !saleDepositConfirmationShared(result.sale, document.id)) {
        throw new Error('The confirmation could not be verified. Reload the sale before trying again.');
      }
      setOpen(false);
      onSaved(result.sale);
    } catch (cause) {
      if (!controller.signal.aborted) setError(
        cause instanceof HttpApiError && cause.data && typeof cause.data === 'object' && 'error' in cause.data
          ? String(cause.data.error)
          : cause instanceof Error ? cause.message : 'The confirmation could not be saved. Try again.',
      );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      active.current = null;
    }
  }

  if (saleDepositConfirmationShared(sale, document.id)) return null;

  return <>
    <Button variant="outline" disabled={disabled || busy} onClick={() => { setError(''); setOpen(true); }}>
      <Check size={18} aria-hidden="true"/>Mark receipt as shared
    </Button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy}>
        <DialogHeader>
          <DialogTitle>Have you shared the deposit receipt?</DialogTitle>
          <DialogDescription>Confirm you already gave the receipt to the customer or sent it outside the portal. This records what you did.</DialogDescription>
        </DialogHeader>
        <p>{document.number} · {document.snapshot.draft.customer}</p>
        {error && <p className="invoice-error" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Go back</Button>
          <Button disabled={disabled || busy} onClick={() => void markShared()}>{busy ? 'Saving…' : 'Yes, mark as shared'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
