import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { canonicalCustomerEmail, canonicalCustomerName, canonicalCustomerPhone } from '@workspace/vehicle-meta';
import { Check, Clock3, Mail, Phone, UserRound, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import './recent-customer-fields.css';

export type CustomerContact = { customerName: string; phone?: string | null; email?: string | null };
export type RecentCustomer = CustomerContact & { id: string; lastUsedAt?: string | null; detail?: string };
type ContactField = 'customerName' | 'phone' | 'email';
type RecentCustomerFieldsProps = {
  value: CustomerContact;
  onChange: (contact: CustomerContact) => void;
  customers: RecentCustomer[];
  onSelect?: (customer: RecentCustomer) => void;
  disabled?: boolean;
  suggestionsDisabled?: boolean;
  nameLabel?: string;
  phoneLabel?: string;
  emailLabel?: string;
  nameRequired?: boolean;
  nameMaxLength?: number;
  nameMinLength?: number;
  phoneRequired?: boolean;
  emailRequired?: boolean;
  className?: string;
};

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const recency = (value?: string | null) => { const timestamp = Date.parse(value ?? ''); return Number.isFinite(timestamp) ? timestamp : 0; };
const contactKey = (contact: CustomerContact) => JSON.stringify([contact.customerName, contact.phone ?? '', contact.email ?? '']);
const comparison = (field: ContactField, value: unknown) => field === 'customerName' ? canonicalCustomerName(value) : field === 'email' ? canonicalCustomerEmail(value) || clean(value).toLowerCase() : canonicalCustomerPhone(value) || clean(value);

/** Full numbers use the shared contact normalizer; partial numbers must match from the country/trunk prefix. */
export function recentCustomerPhonePrefix(value: string): string {
  const complete = canonicalCustomerPhone(value);
  if (complete) return complete;
  const compact = value.trim().replace(/^(\+44|0044)\s*\(0\)/, '$1').replace(/[\s().\-/]/g, '');
  if (!/^\+?\d+$/.test(compact) || compact.replace(/\D/g, '').length < 3) return '';
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;
  if (compact.startsWith('+')) return compact;
  if (/^0[1-9]/.test(compact)) return `+44${compact.slice(1)}`;
  if (/^44[1-9]/.test(compact)) return `+${compact}`;
  return '';
}

export function findRecentCustomers(customers: RecentCustomer[], field: ContactField, query: string): RecentCustomer[] {
  const search = field === 'customerName' ? canonicalCustomerName(query) : field === 'email' ? query.trim().toLowerCase() : recentCustomerPhonePrefix(query);
  if (!search || (field !== 'phone' && search.length < 2) || (field === 'phone' && query.replace(/\D/g, '').length < 3)) return [];
  const seen = new Set<string>();
  return customers.map((customer, index) => ({ customer, index }))
    .sort((a, b) => recency(b.customer.lastUsedAt) - recency(a.customer.lastUsedAt) || a.index - b.index)
    .filter(({ customer }) => {
      const candidate = field === 'customerName' ? canonicalCustomerName(customer.customerName) : field === 'email' ? clean(customer.email).toLowerCase() : canonicalCustomerPhone(customer.phone);
      if (!candidate || (field === 'phone' ? !candidate.startsWith(search) : !candidate.includes(search))) return false;
      const name = canonicalCustomerName(customer.customerName), phone = canonicalCustomerPhone(customer.phone) || clean(customer.phone), email = canonicalCustomerEmail(customer.email) || clean(customer.email).toLowerCase();
      // A name alone cannot establish that two records describe the same contact.
      const key = name && (phone || email) ? JSON.stringify([name, phone, email]) : `record:${customer.id}:${customer.customerName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5).map(({ customer }) => customer);
}

function lastUsedLabel(value?: string | null) {
  if (!recency(value)) return '';
  return `Last used ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value!))}`;
}

export function RecentCustomerFields({ value, onChange, customers, onSelect, disabled = false, suggestionsDisabled = false, nameLabel = 'Customer name', phoneLabel = 'Phone number', emailLabel = 'Email (optional)', nameRequired = false, nameMaxLength = 120, nameMinLength = 2, phoneRequired = false, emailRequired = false, className = '' }: RecentCustomerFieldsProps) {
  const id = useId();
  const [focused, setFocused] = useState<ContactField | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [review, setReview] = useState<{ customer: RecentCustomer; formKey: string } | null>(null);
  const [selected, setSelected] = useState<{ name: string; formKey: string } | null>(null);
  const inputs = useRef<Partial<Record<ContactField, HTMLInputElement | null>>>({});
  const activeOption = useRef<HTMLButtonElement | null>(null);
  const fields = [
    { field: 'customerName' as const, label: nameLabel, required: nameRequired, type: 'text', icon: UserRound },
    { field: 'phone' as const, label: phoneLabel, required: phoneRequired, type: 'tel', icon: Phone },
    { field: 'email' as const, label: emailLabel, required: emailRequired, type: 'email', icon: Mail },
  ];
  const matches = useMemo(() => focused && !disabled && !suggestionsDisabled ? findRecentCustomers(customers, focused, value[focused] ?? '') : [], [customers, focused, disabled, suggestionsDisabled, value]);
  const menuOpen = Boolean(focused && !dismissed && matches.length);
  const matchKey = JSON.stringify(matches.map(customer => [customer.id, contactKey(customer)]));
  const formKey = contactKey(value);
  const currentReview = !disabled && !suggestionsDisabled && review?.formKey === formKey ? review : null;
  const currentSelection = selected?.formKey === formKey ? selected : null;
  useEffect(() => {
    // Autofilled values can exceed HTML maxLength, which browsers enforce only while typing.
    const name = value.customerName ?? '';
    inputs.current.customerName?.setCustomValidity(name.length > nameMaxLength ? `Use no more than ${nameMaxLength} characters for the customer name.` : nameRequired && name.length > 0 && clean(name).length < nameMinLength ? `Enter at least ${nameMinLength} characters for the customer name.` : '');
  }, [value.customerName, nameMaxLength, nameMinLength, nameRequired]);
  useEffect(() => { setActiveIndex(-1); }, [matchKey]);
  useEffect(() => { if (menuOpen && activeIndex >= 0) activeOption.current?.scrollIntoView?.({ block: 'nearest' }); }, [menuOpen, activeIndex]);
  function apply(customer: RecentCustomer) {
    const contact = { customerName: clean(customer.customerName), phone: clean(customer.phone), email: clean(customer.email) };
    setReview(null); setDismissed(true); setActiveIndex(-1);
    setSelected({ name: contact.customerName || 'customer', formKey: contactKey(contact) });
    onChange(contact); onSelect?.(customer);
  }
  function choose(customer: RecentCustomer) {
    if (disabled || suggestionsDisabled) return;
    const conflict = fields.some(({ field }) => field !== focused && clean(value[field]) && comparison(field, value[field]) !== comparison(field, customer[field]));
    setDismissed(true); setActiveIndex(-1);
    if (conflict) setReview({ customer, formKey }); else apply(customer);
  }
  function change(field: ContactField, text: string) {
    setReview(null); setSelected(null); setDismissed(false); setActiveIndex(-1);
    onChange({ ...value, [field]: text });
  }
  return <div className={`recent-customer-fields ${className}`} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocused(null); setDismissed(false); setActiveIndex(-1); }
  }}>
    <p className="recent-customer-fields-hint" id={`${id}-hint`}>{suggestionsDisabled || disabled ? 'Enter or edit the customer details.' : 'Type a name, phone number or email to autofill recent customer details.'}</p>
    {fields.map(({ field, label, required, type, icon: Icon }) => <div className={`recent-customer-field recent-customer-field-${field}`} key={field}>
      <label htmlFor={`${id}-${field}`}>{label}</label>
      <div className="recent-customer-input-wrap"><Icon size={17} aria-hidden="true" /><Input id={`${id}-${field}`} ref={node => { inputs.current[field] = node; }} name={field} type={type} value={value[field] ?? ''} required={required} disabled={disabled} autoComplete="off" minLength={field === 'customerName' && nameRequired ? nameMinLength : undefined} maxLength={field === 'customerName' ? nameMaxLength : field === 'email' ? 320 : 40} role="combobox" aria-autocomplete="list" aria-expanded={menuOpen && focused === field} aria-controls={menuOpen && focused === field ? `${id}-suggestions` : undefined} aria-activedescendant={menuOpen && focused === field && activeIndex >= 0 && activeIndex < matches.length ? `${id}-option-${activeIndex}` : undefined} aria-describedby={`${id}-hint`} onChange={event => change(field, event.target.value)} onFocus={() => { setFocused(field); setDismissed(false); setActiveIndex(-1); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { if (menuOpen) event.preventDefault(); setDismissed(true); setActiveIndex(-1); }
        else if (event.key === 'Tab') { setDismissed(true); setActiveIndex(-1); }
        else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
          event.preventDefault(); setDismissed(false);
          setActiveIndex(index => event.key === 'ArrowDown' ? (index + 1) % matches.length : index < 0 ? matches.length - 1 : (index - 1 + matches.length) % matches.length);
        } else if (event.key === 'Enter' && menuOpen) {
          event.preventDefault();
          if (activeIndex >= 0 && matches[activeIndex]) choose(matches[activeIndex]);
        }
      }} /></div>
      {menuOpen && focused === field && <div className="recent-customer-popup">
        <p className="recent-customer-popup-title">Recent customers <span>Choose to autofill</span></p>
        <ul role="listbox" id={`${id}-suggestions`} aria-label="Recent customer suggestions">{matches.map((customer, index) => <li key={`${customer.id}-${index}`} role="none"><button ref={node => { if (index === activeIndex) activeOption.current = node; }} type="button" role="option" id={`${id}-option-${index}`} aria-selected={index === activeIndex} tabIndex={-1} className="recent-customer-option" onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(customer)}>
          <strong>{customer.customerName || 'Name not recorded'}</strong>
          <span className="recent-customer-option-contact">{[clean(customer.phone), clean(customer.email)].filter(Boolean).join(' · ') || 'No contact details recorded'}</span>
          {(customer.detail || lastUsedLabel(customer.lastUsedAt)) && <span className="recent-customer-option-meta"><Clock3 size={13} aria-hidden="true" /><span>{[lastUsedLabel(customer.lastUsedAt), customer.detail].filter(Boolean).join(' · ')}</span></span>}
        </button></li>)}</ul>
      </div>}
    </div>)}
    {currentReview && <section className="recent-customer-review" role="group" aria-live="polite" aria-label={`Review contact details for ${currentReview.customer.customerName}`}>
      <strong>Replace the details already entered?</strong>
      <p>Check with the customer before replacing different contact details.</p>
      <div className="recent-customer-review-columns"><div><span>On this form</span><p>{value.customerName || 'Name not entered'}</p><p>{value.phone || 'No phone number'}</p><p>{value.email || 'No email address'}</p></div><div><span>Recent customer</span><p>{currentReview.customer.customerName || 'Name not recorded'}</p><p>{currentReview.customer.phone || 'No phone number'}</p><p>{currentReview.customer.email || 'No email address'}</p></div></div>
      <p className="recent-customer-review-note">Only this form changes. Existing enquiries, appointments and sales stay separate.</p>
      <div className="recent-customer-review-actions"><Button type="button" onClick={() => apply(currentReview.customer)}>Use these details</Button><Button type="button" variant="outline" onClick={() => { setReview(null); inputs.current[focused ?? 'customerName']?.focus(); }}>Keep current details</Button></div>
    </section>}
    {currentSelection && <div className="recent-customer-confirmation" role="status"><Check size={16} aria-hidden="true" /><span>Details filled for {currentSelection.name}. You can still edit them.</span><button type="button" aria-label="Dismiss autofill confirmation" onClick={() => setSelected(null)}><X size={16} aria-hidden="true" /></button></div>}
  </div>;
}
