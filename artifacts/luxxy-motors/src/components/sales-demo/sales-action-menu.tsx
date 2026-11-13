import { useId } from 'react';
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

export function SalesActionMenu({ onChoose, disabled = false, unavailable = {}, requestTitle, handoverCompleted = false, includeReturn = true, includeRequest = true }: {
  onChoose: (action: SaleAction) => void; disabled?: boolean; unavailable?: Partial<Record<SaleAction, string>>; requestTitle?: string; handoverCompleted?: boolean; includeReturn?: boolean; includeRequest?: boolean;
}) {
  const menuId = useId();
  return <div className="sales-flow-menu" aria-label="Choose what to do">
    {saleActions.filter(({ id }) => (includeReturn || id !== 'return') && (includeRequest || id !== 'request')).map(({ id, title, description, icon: Icon }) => {
      const reason = unavailable[id];
      const viewingHandover = id === 'handover' && handoverCompleted;
      const isDisabled = disabled || Boolean(reason);
      const titleId = `${menuId}-${id}-title`;
      const helpId = `${menuId}-${id}-help`;
      return <button key={id} type="button" disabled={isDisabled} onClick={() => onChoose(id)} aria-labelledby={titleId} aria-describedby={helpId}>
        <Icon className="sales-flow-menu-icon" size={30} aria-hidden="true" />
        <span><strong id={titleId}>{id === 'request' && requestTitle ? requestTitle : viewingHandover ? 'View handover' : title}</strong><small id={helpId}>{reason || (viewingHandover ? 'See the recorded collection or delivery.' : description)}</small></span>
        {!isDisabled && <ChevronRight size={22} aria-hidden="true" />}
      </button>;
    })}
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
