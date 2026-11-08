import type { SaleWorkspaceDocument } from '@workspace/vehicle-meta';
import { Invoice } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { saleMoney } from './sales-controls';

export function SaleDocumentList({ documents, disabled, onOpen }: {
  documents: readonly SaleWorkspaceDocument[];
  disabled: boolean;
  onOpen: (document: SaleWorkspaceDocument) => void;
}) {
  const newestFirst = [...documents].reverse();
  const supplements = new Map<string, SaleWorkspaceDocument[]>();
  const groupedIds = new Set<string>();

  for (const document of newestFirst) {
    if (document.type !== 'delivery-invoice' || document.transaction?.kind !== 'delivery-invoice') continue;
    const references = document.transaction.invoiceReferences ?? [];
    const vehicleInvoice = newestFirst.find(invoice =>
      invoice.type === 'invoice' && invoice.invoiceKind !== 'deposit' && references.includes(invoice.number));
    if (!vehicleInvoice) continue;
    supplements.set(vehicleInvoice.id, [...(supplements.get(vehicleInvoice.id) ?? []), document]);
    groupedIds.add(document.id);
  }

  function row(document: SaleWorkspaceDocument, groupLabel?: string) {
    const amount = document.transaction?.kind === 'delivery-invoice'
      ? document.transaction.amountPence
      : document.snapshot?.totals?.totalDue;
    return (
      <div className="sale-saved-document" key={document.id}>
        <Invoice size={19} aria-hidden="true" />
        <span>
          <strong>{groupLabel || document.title}</strong>
          <small>{document.number} · {new Date(document.issuedAt).toLocaleDateString('en-GB')}</small>
          {groupLabel && typeof amount === 'number' && <small>{saleMoney(amount)}</small>}
        </span>
        <Button variant="outline" disabled={disabled} onClick={() => onOpen(document)}>View &amp; share</Button>
      </div>
    );
  }

  return (
    <div className="sale-desk-document-list">
      {newestFirst.filter(document => !groupedIds.has(document.id)).map(document => {
        const deliveryInvoices = supplements.get(document.id);
        if (!deliveryInvoices) return row(document);
        return (
          <section className="sale-invoice-group" aria-label="Vehicle invoice and additional delivery charges" key={document.id}>
            <h3>Vehicle and delivery invoices</h3>
            {row(document, 'Vehicle invoice total')}
            {deliveryInvoices.map(invoice => row(invoice, 'Additional delivery charge'))}
          </section>
        );
      })}
    </div>
  );
}
