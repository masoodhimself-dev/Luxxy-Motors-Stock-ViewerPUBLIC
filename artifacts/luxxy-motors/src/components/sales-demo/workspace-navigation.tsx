import { useRef } from 'react';
import { Car, Invoice, Truck, Wallet } from '@/components/icons';

export const salesWorkspaceTabs = [
  { id: 'deal', label: 'Deal', Icon: Car },
  { id: 'payments', label: 'Payments', Icon: Wallet },
  { id: 'invoices', label: 'Invoices', Icon: Invoice },
  { id: 'handover', label: 'Collection & delivery', Icon: Truck },
] as const;
export type SalesWorkspaceTab = typeof salesWorkspaceTabs[number]['id'];

/** Switching a section changes only the view. The parent keeps all unsaved fields. */
export function SalesWorkspaceNavigation({ value, onChange, disabled = false }: {
  value: SalesWorkspaceTab;
  onChange: (value: SalesWorkspaceTab) => void;
  disabled?: boolean;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return <div className="sale-desk-tabs" role="tablist" aria-label="Sale sections">
    {salesWorkspaceTabs.map(({ id, label, Icon }, index) => <button
      key={id}
      ref={element => { buttons.current[index] = element; }}
      type="button"
      role="tab"
      id={`sale-tab-${id}`}
      aria-controls={`sale-panel-${id}`}
      aria-selected={value === id}
      tabIndex={value === id ? 0 : -1}
      disabled={disabled}
      onClick={() => onChange(id)}
      onKeyDown={event => {
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? salesWorkspaceTabs.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % salesWorkspaceTabs.length
          : event.key === 'ArrowLeft' ? (index + salesWorkspaceTabs.length - 1) % salesWorkspaceTabs.length : null;
        if (target === null || disabled) return;
        event.preventDefault();
        onChange(salesWorkspaceTabs[target].id);
        buttons.current[target]?.focus();
      }}
    ><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}
  </div>;
}
