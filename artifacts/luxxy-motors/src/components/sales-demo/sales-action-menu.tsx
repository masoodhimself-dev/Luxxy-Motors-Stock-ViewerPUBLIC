import { Car, ChevronRight, Invoice, Mail, RotateCcw, Truck, Wallet } from '@/components/icons';

export type SaleAction = 'request' | 'deposit' | 'payment' | 'invoice' | 'handover' | 'return';
export const saleActions = [
  { id: 'request', title: 'Request a deposit', description: 'Ask the customer to pay a set amount.', icon: Mail },
  { id: 'deposit', title: 'Take a deposit', description: 'Record a deposit you have received.', icon: Wallet },
  { id: 'payment', title: 'Take a payment', description: 'Record part or all of the balance.', icon: Wallet },
  { id: 'invoice', title: 'Create an invoice', description: 'Prepare the paperwork for this sale.', icon: Invoice },
  { id: 'handover', title: 'Arrange collection or delivery', description: 'Set the date, address and delivery charge.', icon: Truck },
  { id: 'return', title: 'Return or change a car', description: 'Find the original sale to get started.', icon: RotateCcw },
] as const;

export function SalesActionMenu({ onChoose, disabled = false, unavailable = {}, requestTitle }: {
  onChoose: (action: SaleAction) => void; disabled?: boolean; unavailable?: Partial<Record<SaleAction, string>>; requestTitle?: string;
}) {
  return <div className="sales-flow-menu" aria-label="Choose what to do">
    {saleActions.map(({ id, title, description, icon: Icon }) => <button key={id} type="button"
      disabled={disabled || Boolean(unavailable[id])} onClick={() => onChoose(id)} aria-describedby={`sale-action-help-${id}`}>
      <Icon className="sales-flow-menu-icon" size={30} aria-hidden="true" />
      <span><strong>{id === 'request' && requestTitle ? requestTitle : title}</strong><small id={`sale-action-help-${id}`}>{unavailable[id] || description}</small></span>
      <ChevronRight size={22} aria-hidden="true" />
    </button>)}
  </div>;
}

export function SalesFlowSteps({ step, onChoose, disabled = false }: { step: 0 | 1 | 2; onChoose: (step: 0 | 1 | 2) => void; disabled?: boolean }) {
  return <nav className="sales-flow-steps" aria-label="Sale steps">
    {['Car', 'Customer', 'Choose what to do'].map((label, index) => <button type="button" key={label}
      aria-current={index === step ? 'step' : undefined} disabled={disabled || index > step} onClick={() => onChoose(index as 0 | 1 | 2)}>
      <span aria-hidden="true">{index + 1}</span>{label}
    </button>)}
  </nav>;
}
