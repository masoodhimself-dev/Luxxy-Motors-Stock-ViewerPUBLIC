import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { partExchangeChecklistItems, saleCompletionChecklistItems, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { emptyDraft } from './model';
import { SaleChecklists } from './sale-checklists';

const draft = { ...emptyDraft(), customer: 'Jamie', vehicle: 'Ford Focus', vehicleId: 'test-car', price: '10000' } as SaleWorkspaceDraft;

it('starts pending and lets staff explicitly check, mark not needed or undo an individual check', () => {
  const onChange = vi.fn();
  const { rerender } = render(<SaleChecklists draft={draft} onChange={onChange} />);
  expect(screen.getByText('5 to check')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Check: Customer and vehicle confirmed' }));
  expect(onChange).toHaveBeenLastCalledWith({ completion: { customer_vehicle: 'checked' } });
  const checklists = { completion: { customer_vehicle: { status: 'checked' as const, actor: 'Masood', at: '2026-10-20T12:00:00Z' } }, partExchanges: {} };
  rerender(<SaleChecklists draft={draft} checklists={checklists} onChange={onChange} />);
  expect(screen.getByText('Saved by Masood')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Check: Customer and vehicle confirmed' }));
  expect(onChange).toHaveBeenLastCalledWith({ completion: { customer_vehicle: 'pending' } });
  fireEvent.click(screen.getByRole('button', { name: 'Not needed: Documents reviewed with the customer' }));
  expect(onChange).toHaveBeenLastCalledWith({ completion: { documents: 'not_needed' } });
});

it('keeps intake checks separate for each part-exchange car', () => {
  const onChange = vi.fn();
  render(<SaleChecklists intakeOnly draft={{ ...draft, exchanges: [
    { registration: 'AB20 XYZ', description: 'Focus', value: '1000' },
    { registration: 'CD21 DEF', description: 'Fiesta', value: '2000' },
  ] }} onChange={onChange} />);
  expect(screen.queryByText('Final sale checks')).not.toBeInTheDocument();
  const first = screen.getByText('Part-exchange intake — AB20 XYZ').closest('details')!;
  const second = screen.getByText('Part-exchange intake — CD21 DEF').closest('details')!;
  fireEvent.click(within(first).getByRole('checkbox', { name: 'Check: Registration and VIN checked' }));
  expect(onChange).toHaveBeenLastCalledWith({ partExchanges: [{ registration: 'AB20XYZ', items: { identity: 'checked' } }] });
  fireEvent.click(within(second).getByRole('button', { name: 'Not needed: Finance position reviewed' }));
  expect(onChange).toHaveBeenLastCalledWith({ partExchanges: [{ registration: 'CD21DEF', items: { finance: 'not_needed' } }] });
});

it('does not permit checks without a part-exchange registration or while saving', () => {
  const onChange = vi.fn();
  const { rerender } = render(<SaleChecklists intakeOnly draft={{ ...draft, exchanges: [{ registration: '', description: '', value: '' }] }} onChange={onChange} />);
  for (const control of screen.getAllByRole('checkbox')) expect(control).toBeDisabled();
  expect(screen.getByText(/Enter this car’s registration/)).toBeVisible();
  rerender(<SaleChecklists draft={draft} busy onChange={onChange} />);
  expect(screen.getByText('Saving checks…')).toBeVisible();
  for (const control of screen.getAllByRole('checkbox')) expect(control).toBeDisabled();
  for (const control of screen.getAllByRole('button')) expect(control).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
});

it('shows completed checks without allowing historical attestations to be changed', () => {
  const onChange = vi.fn();
  const evidence = { status: 'not_needed' as const, actor: 'Jamie', at: '2026-10-20T12:00:00Z' };
  render(<SaleChecklists draft={draft} readOnly checklists={{ completion: Object.fromEntries(saleCompletionChecklistItems.map(item => [item.id, evidence])), partExchanges: {} }} onChange={onChange} />);
  expect(screen.getByText('Checks complete')).toBeVisible();
  for (const control of screen.getAllByRole('button')) expect(control).toBeDisabled();
  expect(partExchangeChecklistItems).toHaveLength(5);
});
