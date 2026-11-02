import { createRef, useState, type ComponentProps } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findRecentCustomers, recentCustomerPhonePrefix, RecentCustomerFields, type CustomerContact, type RecentCustomer } from './recent-customer-fields';

const alex: RecentCustomer = { id: 'alex-new', customerName: 'Alex Customer', phone: '07700900123', email: 'alex@example.test', lastUsedAt: '2026-10-18T09:00:00Z', detail: 'ENQ-102 · Ford Fiesta' };
const jamie: RecentCustomer = { id: 'jamie', customerName: 'Jamie Customer', phone: '07700900456', email: 'jamie@example.test', lastUsedAt: '2026-10-17T09:00:00Z' };
type HarnessProps = { initial?: CustomerContact; customers?: RecentCustomer[]; onSelect?: (customer: RecentCustomer) => void; disabled?: boolean; suggestionsDisabled?: boolean } & Pick<ComponentProps<typeof RecentCustomerFields>, 'compact' | 'showIcons' | 'errors' | 'inputRefs' | 'nameRequired' | 'phoneRequired' | 'emailRequired'>;
function Harness({ initial = { customerName: '', phone: '', email: '' }, customers = [alex, jamie], onSelect = vi.fn(), disabled = false, suggestionsDisabled = false, ...props }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return <form onSubmit={event => event.preventDefault()}><RecentCustomerFields value={value} onChange={setValue} customers={customers} onSelect={onSelect} disabled={disabled} suggestionsDisabled={suggestionsDisabled} {...props} /><button type="submit">Save enquiry</button></form>;
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
  it('keeps all fields, visible helper text and decorative icons for default consumers', () => {
    const { container } = render(<Harness />);
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(field('Email (optional)')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add email' })).not.toBeInTheDocument();
    expect(screen.getByText('Type a name, phone number or email to autofill recent customer details.')).not.toHaveClass('sr-only');
    expect(container.querySelectorAll('.recent-customer-input-wrap > svg')).toHaveLength(3);
  });

  it('shows required name and phone immediately in compact mode and focuses email only after Add email', () => {
    const { container } = render(<Harness compact nameRequired phoneRequired />);
    expect(field()).toBeRequired();
    expect(field('Phone number')).toBeRequired();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: 'Email (optional)' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('.recent-customer-input-wrap > svg')).toHaveLength(0);
    const helper = screen.getByText('Type to find a recent customer, or enter new details.');
    expect(helper).toHaveClass('sr-only');
    expect(field()).toHaveAttribute('aria-describedby', helper.id);
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }));
    expect(field('Email (optional)')).toHaveFocus();
    expect(field('Email (optional)')).not.toBeRequired();
    expect(screen.queryByRole('button', { name: 'Add email' })).not.toBeInTheDocument();
    fireEvent.change(field('Email (optional)'), { target: { value: 'new@example.test' } });
    expect(field('Email (optional)')).toHaveValue('new@example.test');
    fireEvent.change(field('Email (optional)'), { target: { value: '' } });
    expect(field('Email (optional)')).toBeVisible();
  });

  it('keeps required email visible and respects an explicit icon preference in compact mode', () => {
    const { container } = render(<Harness compact emailRequired showIcons />);
    expect(field('Email (optional)')).toBeRequired();
    expect(screen.queryByRole('button', { name: 'Add email' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('.recent-customer-input-wrap > svg')).toHaveLength(3);
  });

  it('keeps a supplied email visible and reveals an explicitly autofilled email without moving focus away from the active name field', () => {
    const first = render(<Harness compact initial={{ customerName: '', phone: '', email: 'saved@example.test' }} />);
    expect(field('Email (optional)')).toHaveValue('saved@example.test');
    expect(screen.queryByRole('button', { name: 'Add email' })).not.toBeInTheDocument();
    first.unmount();
    render(<Harness compact />);
    act(() => field().focus());
    fireEvent.change(field(), { target: { value: 'Al' } });
    expect(screen.queryByRole('combobox', { name: 'Email (optional)' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Alex Customer/ }));
    expect(field('Email (optional)')).toHaveValue(alex.email);
    expect(field()).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Add email' })).not.toBeInTheDocument();
  });

  it('reveals an email error, links inline validation and supplies refs for parent-directed focus', () => {
    const inputRefs = { customerName: createRef<HTMLInputElement>(), phone: createRef<HTMLInputElement>(), email: createRef<HTMLInputElement>() };
    const view = render(<Harness compact nameRequired phoneRequired inputRefs={inputRefs} />);
    expect(inputRefs.customerName.current).toBe(field());
    expect(inputRefs.phone.current).toBe(field('Phone number'));
    expect(inputRefs.email.current).toBeNull();
    view.rerender(<Harness compact nameRequired phoneRequired inputRefs={inputRefs} errors={{ customerName: 'Enter a name.', phone: 'Enter a contact number.', email: 'Check the email address.' }} />);
    for (const [label, message] of [['Customer name', 'Enter a name.'], ['Phone number', 'Enter a contact number.'], ['Email (optional)', 'Check the email address.']]) {
      const input = field(label), error = screen.getByText(message);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
      expect(error).toHaveAttribute('role', 'alert');
    }
    expect(inputRefs.email.current).toBe(field('Email (optional)'));
    act(() => inputRefs.customerName.current?.focus());
    expect(field()).toHaveFocus();
    act(() => inputRefs.email.current?.focus());
    expect(field('Email (optional)')).toHaveFocus();
    view.rerender(<Harness compact nameRequired phoneRequired inputRefs={inputRefs} />);
    expect(field('Email (optional)')).toBeVisible();
    expect(field('Email (optional)')).not.toHaveAttribute('aria-invalid');
    view.unmount();
    expect(inputRefs.customerName.current).toBeNull();
    expect(inputRefs.phone.current).toBeNull();
    expect(inputRefs.email.current).toBeNull();
  });

  it('keeps compact Add email disabled along with the contact fields', () => {
    render(<Harness compact disabled />);
    expect(screen.getByRole('button', { name: 'Add email' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }));
    expect(screen.queryByRole('combobox', { name: 'Email (optional)' })).not.toBeInTheDocument();
    expect(field()).toBeDisabled();
  });

  it('preserves explicit conflict review and keyboard autofill in compact mode', () => {
    render(<Harness compact initial={{ customerName: '', phone: '07700900999', email: '' }} />);
    typeName();
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByRole('group', { name: 'Review contact details for Alex Customer' })).toBeVisible();
    expect(field('Phone number')).toHaveValue('07700900999');
    expect(screen.queryByRole('combobox', { name: 'Email (optional)' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use these details' }));
    expect(field('Phone number')).toHaveValue(alex.phone);
    expect(field('Email (optional)')).toHaveValue(alex.email);
  });

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
