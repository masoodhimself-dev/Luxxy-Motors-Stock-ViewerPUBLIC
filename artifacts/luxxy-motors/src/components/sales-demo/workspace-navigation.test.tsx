import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { SalesWorkspaceNavigation, type SalesWorkspaceTab } from './workspace-navigation';

it('keeps the sale draft when staff switch sections', () => {
  function Desk() {
    const [tab, setTab] = useState<SalesWorkspaceTab>('deal');
    const [customer, setCustomer] = useState('');
    return <><SalesWorkspaceNavigation value={tab} onChange={setTab} />
      {tab === 'deal' && <input aria-label="Customer" value={customer} onChange={event => setCustomer(event.target.value)} />}
    </>;
  }
  render(<Desk />);
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Jamie Patel' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
  expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Deal' }));
  expect(screen.getByLabelText('Customer')).toHaveValue('Jamie Patel');
});

it('supports arrow, Home and End navigation with matching panel links', () => {
  const onChange = vi.fn();
  render(<SalesWorkspaceNavigation value="deal" onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Deal' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith('payments');
  expect(screen.getByRole('tab', { name: 'Payments' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Payments' }), { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith('handover');
  expect(screen.getByRole('tab', { name: 'Collection & delivery' })).toHaveAttribute('aria-controls', 'sale-panel-handover');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Collection & delivery' }), { key: 'Home' });
  expect(onChange).toHaveBeenLastCalledWith('deal');
});

it('does not switch sections while a financial action is saving', () => {
  const onChange = vi.fn();
  render(<SalesWorkspaceNavigation value="invoices" onChange={onChange} disabled />);
  for (const tab of screen.getAllByRole('tab')) expect(tab).toBeDisabled();
  fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
  expect(onChange).not.toHaveBeenCalled();
});
