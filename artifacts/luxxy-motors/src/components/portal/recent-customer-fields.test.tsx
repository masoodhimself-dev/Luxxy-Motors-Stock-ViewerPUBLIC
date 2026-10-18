import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findRecentCustomers, recentCustomerPhonePrefix, RecentCustomerFields, type CustomerContact, type RecentCustomer } from './recent-customer-fields';

const alex: RecentCustomer = { id: 'alex-new', customerName: 'Alex Customer', phone: '07700900123', email: 'alex@example.test', lastUsedAt: '2026-10-18T09:00:00Z', detail: 'ENQ-102 · Ford Fiesta' };
const jamie: RecentCustomer = { id: 'jamie', customerName: 'Jamie Customer', phone: '07700900456', email: 'jamie@example.test', lastUsedAt: '2026-10-17T09:00:00Z' };
function Harness({ initial = { customerName: '', phone: '', email: '' }, customers = [alex, jamie], onSelect = vi.fn(), disabled = false, suggestionsDisabled = false }: { initial?: CustomerContact; customers?: RecentCustomer[]; onSelect?: (customer: RecentCustomer) => void; disabled?: boolean; suggestionsDisabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <form onSubmit={event => event.preventDefault()}><RecentCustomerFields value={value} onChange={setValue} customers={customers} onSelect={onSelect} disabled={disabled} suggestionsDisabled={suggestionsDisabled} /><button type="submit">Save enquiry</button></form>;
}
const field = (name = 'Customer name') => screen.getByRole('combobox', { name });
function typeName(value = 'Al') { fireEvent.focus(field()); fireEvent.change(field(), { target: { value } }); }

describe('recent customer suggestions', () => {
  it('orders by valid last-used date, limits to five, and retains conflicting contact details', () => {
    const customers = [
      { ...alex, id: 'old', lastUsedAt: '2026-10-01T09:00:00Z' },
      { ...alex, id: 'normalized-copy', customerName: ' ALEX  Customer ', phone: '+44 7700 900123', email: 'ALEX@EXAMPLE.TEST' },
      { ...alex, id: 'conflicting-email', email: 'another@example.test', lastUsedAt: '2026-10-17T09:00:00Z' },
      ...Array.from({ length: 5 }, (_, index) => ({ ...alex, id: `other-${index}`, customerName: `Alex Person ${index}`, phone: `0770090020${index}`, lastUsedAt: `2026-10-1${index}T09:00:00Z` })),
      { ...alex, id: 'invalid-date', customerName: 'Alex Invalid date', lastUsedAt: 'not a date' },
    ];
    expect(findRecentCustomers(customers, 'customerName', 'al').map(customer => customer.id)).toEqual(['normalized-copy', 'conflicting-email', 'other-4', 'other-3', 'other-2']);
    expect(findRecentCustomers(customers, 'customerName', 'invalid')[0].id).toBe('invalid-date');
  });

  it('keeps missing versus present contact details separate and never deduplicates by name alone', () => {
    const customers = [{ ...alex, id: 'complete' }, { ...alex, id: 'missing-email', email: '' }, { id: 'name-a', customerName: alex.customerName }, { id: 'name-b', customerName: alex.customerName }];
    expect(findRecentCustomers(customers, 'customerName', 'al')).toHaveLength(4);
  });

  it.each(['077', '+44 77', '0044 77', '4477', '+44 (0)77', '0044 (0)77'])('finds a UK number by its safe starting prefix %s', query => {
    expect(findRecentCustomers([alex], 'phone', query).map(customer => customer.id)).toEqual([alex.id]);
  });

  it('requires three phone digits and never guesses a country code from a local suffix', () => {
    expect(findRecentCustomers([alex], 'phone', '07')).toEqual([]);
    expect(findRecentCustomers([alex], 'phone', '900123')).toEqual([]);
    expect(findRecentCustomers([alex], 'phone', '7700900123')).toEqual([]);
    expect(recentCustomerPhonePrefix('077-call-now')).toBe('');
    expect(findRecentCustomers([{ ...alex, phone: '+33 6 12 34 56 78' }], 'phone', '0033 6')).toHaveLength(1);
    expect(findRecentCustomers([{ ...alex, phone: '+33 6 12 34 56 78' }], 'phone', '0612')).toHaveLength(0);
  });

  it('searches only the active field and preserves email plus-tags and domains', () => {
    expect(findRecentCustomers([alex], 'customerName', 'a')).toEqual([]);
    expect(findRecentCustomers([alex], 'email', 'a')).toEqual([]);
    expect(findRecentCustomers([alex], 'email', 'ALEx@')).toHaveLength(1);
    expect(findRecentCustomers([alex], 'email', 'customer')).toEqual([]);
    expect(findRecentCustomers([{ ...alex, email: 'alex+car@example.test' }], 'email', 'alex@example')).toEqual([]);
  });
});

describe('RecentCustomerFields', () => {
  it('keeps blank fields and no-match queries unobtrusive and editable for a new customer', () => {
    render(<Harness initial={{ customerName: '', phone: null, email: undefined }} />);
    expect(field()).toHaveValue(''); expect(field('Phone number')).toHaveValue(''); expect(field('Email (optional)')).toHaveValue('');
    fireEvent.focus(field()); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.change(field(), { target: { value: 'Brand new customer' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveValue('Brand new customer');
  });

  it('shows a small recent contact card and fills details only after an explicit click', () => {
    const onSelect = vi.fn(), before = JSON.stringify(alex);
    render(<Harness onSelect={onSelect} />);
    typeName();
    expect(onSelect).not.toHaveBeenCalled();
    expect(field('Phone number')).toHaveValue('');
    const option = screen.getByRole('option', { name: /Alex Customer/ });
    expect(option).toHaveTextContent('07700900123'); expect(option).toHaveTextContent('alex@example.test');
    expect(option).toHaveTextContent('Last used 18 Oct 2026'); expect(option).toHaveTextContent('ENQ-102 · Ford Fiesta');
    fireEvent.click(option);
    expect(field()).toHaveValue(alex.customerName); expect(field('Phone number')).toHaveValue(alex.phone); expect(field('Email (optional)')).toHaveValue(alex.email);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(alex);
    expect(screen.getByRole('status')).toHaveTextContent('Details filled for Alex Customer');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(JSON.stringify(alex)).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss autofill confirmation' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('uses keyboard highlight and explicit Enter, preventing an unchosen suggestion from submitting the form', () => {
    const onSelect = vi.fn(); render(<Harness onSelect={onSelect} />); typeName('customer');
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(fireEvent.keyDown(field(), { key: 'Enter' })).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    const active = screen.getAllByRole('option')[0];
    expect(active).toHaveAttribute('aria-selected', 'true'); expect(field()).toHaveAttribute('aria-activedescendant', active.id);
    expect(fireEvent.keyDown(field(), { key: 'Enter' })).toBe(false);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(alex);
  });

  it('never autofills on Tab, blur or Escape, and can reopen with an arrow key', () => {
    const onSelect = vi.fn(); render(<Harness onSelect={onSelect} />); typeName();
    fireEvent.keyDown(field(), { key: 'ArrowDown' }); fireEvent.keyDown(field(), { key: 'Tab' });
    expect(onSelect).not.toHaveBeenCalled(); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.blur(field()); expect(field('Phone number')).toHaveValue('');
    fireEvent.focus(field()); fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(screen.getByRole('listbox')).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('reviews conflicting entered details before replacing them and never merges original records', () => {
    const onSelect = vi.fn(); render(<Harness initial={{ customerName: '', phone: '07700900999', email: 'new@example.test' }} onSelect={onSelect} />);
    typeName(); fireEvent.click(screen.getByRole('option', { name: /Alex Customer/ }));
    const review = within(screen.getByRole('group', { name: 'Review contact details for Alex Customer' }));
    expect(onSelect).not.toHaveBeenCalled(); expect(field('Phone number')).toHaveValue('07700900999');
    expect(review.getByText('07700900999')).toBeVisible(); expect(review.getByText('07700900123')).toBeVisible();
    expect(review.getByText(/Existing enquiries, appointments and sales stay separate/)).toBeVisible();
    fireEvent.click(review.getByRole('button', { name: 'Keep current details' }));
    expect(field('Phone number')).toHaveValue('07700900999'); expect(onSelect).not.toHaveBeenCalled();
    fireEvent.focus(field()); fireEvent.click(screen.getByRole('option', { name: /Alex Customer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use these details' }));
    expect(field('Phone number')).toHaveValue(alex.phone); expect(onSelect).toHaveBeenCalledExactlyOnceWith(alex);
  });

  it('does not flag formatted equivalents or the active typed query as conflicting details', () => {
    const onSelect = vi.fn(); render(<Harness initial={{ customerName: '', phone: '+44 7700 900123', email: 'ALEX@EXAMPLE.TEST' }} onSelect={onSelect} />);
    typeName(); fireEvent.click(screen.getByRole('option', { name: /Alex Customer/ }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument(); expect(onSelect).toHaveBeenCalledExactlyOnceWith(alex);
  });

  it('invalidates an open review and filled confirmation when the form changes', () => {
    const onSelect = vi.fn(); render(<Harness initial={{ customerName: '', phone: '07700900999' }} onSelect={onSelect} />);
    typeName(); fireEvent.click(screen.getByRole('option', { name: /Alex Customer/ }));
    expect(screen.getByRole('button', { name: 'Use these details' })).toBeVisible();
    fireEvent.change(field('Phone number'), { target: { value: '07700900888' } });
    expect(screen.queryByRole('button', { name: 'Use these details' })).not.toBeInTheDocument(); expect(onSelect).not.toHaveBeenCalled();
    fireEvent.focus(field()); fireEvent.click(screen.getByRole('option', { name: /Alex Customer/ })); fireEvent.click(screen.getByRole('button', { name: 'Use these details' }));
    fireEvent.change(field(), { target: { value: 'Alex Edited' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('can disable contact suggestions while retaining manual corrections', () => {
    const onSelect = vi.fn(); render(<Harness suggestionsDisabled onSelect={onSelect} />); typeName();
    expect(field()).not.toBeDisabled(); expect(field()).toHaveValue('Al'); expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); expect(onSelect).not.toHaveBeenCalled();
  });

  it('supports required labels and disabled fields without offering suggestions', () => {
    render(<RecentCustomerFields value={alex} onChange={vi.fn()} customers={[alex]} disabled nameLabel="Full name" phoneLabel="Telephone" emailLabel="Email address" nameRequired phoneRequired emailRequired />);
    for (const label of ['Full name', 'Telephone', 'Email address']) { expect(field(label)).toBeDisabled(); expect(field(label)).toBeRequired(); expect(field(label)).toHaveAttribute('aria-expanded', 'false'); }
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('retains name constraints and blocks an overlong autofilled name without silently truncating it', () => {
    const customer = { ...alex, customerName: `Alex ${'a'.repeat(125)}` };
    render(<Harness customers={[customer]} />);
    expect(field()).toHaveAttribute('maxlength', '120');
    typeName(); fireEvent.click(screen.getByRole('option', { name: /Alex/ }));
    expect(field()).toHaveValue(customer.customerName); expect(field()).toBeInvalid();
    expect((field() as HTMLInputElement).validationMessage).toBe('Use no more than 120 characters for the customer name.');
    fireEvent.change(field(), { target: { value: 'Alex Corrected' } });
    expect(field()).toBeValid();
  });

  it('allows the owning form to preserve its name length requirements', () => {
    const { rerender } = render(<RecentCustomerFields value={{ customerName: 'A' }} customers={[]} onChange={vi.fn()} nameRequired nameMaxLength={200} />);
    expect(field()).toHaveAttribute('minlength', '2'); expect(field()).toHaveAttribute('maxlength', '200'); expect(field()).toBeInvalid();
    rerender(<RecentCustomerFields value={{ customerName: 'Alex' }} customers={[]} onChange={vi.fn()} nameRequired nameMaxLength={200} />);
    expect(field()).toBeValid();
  });

  it('clears keyboard highlight when incoming recent customers change', () => {
    const onSelect = vi.fn(), { rerender } = render(<RecentCustomerFields value={{ customerName: 'Customer' }} customers={[alex]} onChange={vi.fn()} onSelect={onSelect} />);
    fireEvent.focus(field()); fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    rerender(<RecentCustomerFields value={{ customerName: 'Customer' }} customers={[jamie]} onChange={vi.fn()} onSelect={onSelect} />);
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'false'); expect(field()).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(field(), { key: 'Enter' }); expect(onSelect).not.toHaveBeenCalled();
  });
});
