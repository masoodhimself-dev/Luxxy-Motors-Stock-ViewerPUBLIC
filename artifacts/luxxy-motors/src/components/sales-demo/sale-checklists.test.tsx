import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { partExchangeChecklistItems, saleCompletionChecklistItems, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { emptyDraft } from './model';
import { SaleChecklists } from './sale-checklists';

const draft = { ...emptyDraft(), customer: 'Jamie', vehicle: 'Ford Focus', vehicleId: 'test-car', price: '10000' } as SaleWorkspaceDraft;

it('shows final reminders without editable checklist controls or writes', () => {
  const onChange = vi.fn();
  render(<SaleChecklists draft={draft} onChange={onChange} />);
  expect(screen.getByRole('complementary', { name: 'Before completing the sale' })).toBeVisible();
  for (const item of saleCompletionChecklistItems) expect(screen.getByText(item.detail)).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps completed intake checks out of the final reminder', () => {
  const onChange = vi.fn();
  const evidence = { status: 'checked' as const, actor: 'Jamie', at: '2026-10-20T12:00:00Z' };
  render(<SaleChecklists draft={{ ...draft, exchanges: [{ registration: 'AB20 XYZ', description: 'Focus', value: '1000' }] }}
    checklists={{ completion: {}, partExchanges: { AB20XYZ: Object.fromEntries(partExchangeChecklistItems.map(item => [item.id, evidence])) } }} onChange={onChange} />);
  expect(screen.getByText(/No need to complete them again/)).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('links unfinished intake back to Payments without repeating the form', () => {
  const onChange = vi.fn(), onReviewIntake = vi.fn();
  render(<SaleChecklists draft={{ ...draft, exchanges: [{ registration: 'AB20 XYZ', description: 'Focus', value: '1000' }] }} onChange={onChange} onReviewIntake={onReviewIntake} />);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review part-exchange checks' }));
  expect(onReviewIntake).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
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
  rerender(<SaleChecklists intakeOnly draft={{ ...draft, exchanges: [{ registration: 'AB20XYZ', description: 'Focus', value: '1000' }] }} busy onChange={onChange} />);
  expect(screen.getByText('Saving checks…')).toBeVisible();
  for (const control of screen.getAllByRole('checkbox')) expect(control).toBeDisabled();
  for (const control of screen.getAllByRole('button')) expect(control).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps saved intake history read-only', () => {
  const onChange = vi.fn();
  const evidence = { status: 'not_needed' as const, actor: 'Jamie', at: '2026-10-20T12:00:00Z' };
  render(<SaleChecklists intakeOnly draft={{ ...draft, exchanges: [{ registration: 'AB20XYZ', description: 'Focus', value: '1000' }] }} readOnly
    checklists={{ completion: {}, partExchanges: { AB20XYZ: Object.fromEntries(partExchangeChecklistItems.map(item => [item.id, evidence])) } }} onChange={onChange} />);
  expect(screen.getByText('Complete')).toBeVisible();
  fireEvent.click(screen.getByText('Part-exchange intake — AB20XYZ'));
  for (const control of screen.getAllByRole('button')) expect(control).toBeDisabled();
  for (const control of screen.getAllByRole('checkbox')) expect(control).toBeDisabled();
});
