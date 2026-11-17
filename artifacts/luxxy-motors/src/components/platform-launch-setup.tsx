import { useEffect, useId, useState, type FormEvent } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { ArrowRight, Check, Globe2, Mail, StockImport, Users } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const dealerPlans = {
  website_only: { label: 'Website Only', description: 'Customer website and stock listings. Enquiries go to the dealership’s email.' },
  full_portal: { label: 'Full Portal', description: 'Website and staff workspace. Enquiries appear in the DealerOS Inbox.' },
} as const;
export type DealerPlan = keyof typeof dealerPlans;

export function DealerPlanOptions({ value, onChange, disabled }: {
  value: DealerPlan;
  onChange: (value: DealerPlan) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return <fieldset className="platform-plan-options" disabled={disabled}>
    <legend>Choose a plan</legend>
    <div>
      {(Object.entries(dealerPlans) as [DealerPlan, typeof dealerPlans[DealerPlan]][]).map(([plan, option]) => {
        const Icon = plan === 'website_only' ? Globe2 : Users;
        return <label key={plan} className="platform-plan-option">
          <input type="radio" name={name} value={plan} checked={plan === value} onChange={() => onChange(plan)} />
          <Icon size={22} aria-hidden="true" />
          <span><strong>{option.label}</strong><small>{option.description}</small></span>
        </label>;
      })}
    </div>
  </fieldset>;
}

const checkActions = {
  domain: { tab: 'Domains', label: 'Open Domains', Icon: Globe2 },
  stock: { tab: 'Stock connection', label: 'Open Stock connection', Icon: StockImport },
  owner: { tab: 'Staff', label: 'Open Staff', Icon: Users },
  enquiry: { tab: '', label: '', Icon: Mail },
} as const;

type LaunchStatus = {
  plan: DealerPlan;
  enquiryEmail: string | null;
  onboardingRequired: boolean;
  ready: boolean;
  checks: { id: keyof typeof checkActions; label: string; ready: boolean; detail?: string }[];
  testEnquiry: { acceptedAt: string; recipient: string | null; channel?: 'email' | 'inbox'; enquiryId?: string; reference?: string } | null;
};
type LaunchResult = { dealerId: string; status: 'active'; origin: string };

function errorMessage(error: unknown, fallback: string) {
  const detail = (error as { data?: { error?: unknown } })?.data?.error;
  return typeof detail === 'string' ? detail : fallback;
}

export function PlatformLaunchSetup({ dealerId, dealerName, status, onOpenTab, onUpdated, refreshVersion = 0 }: {
  dealerId: string;
  dealerName: string;
  status: string;
  onOpenTab: (name: string) => void;
  onUpdated: () => void | Promise<void>;
  refreshVersion?: number;
}) {
  const endpoint = `/api/platform/dealers/${encodeURIComponent(dealerId)}/onboarding`;
  const [setup, setSetup] = useState<LaunchStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<'load' | 'save' | 'test' | 'launch' | null>('load');
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<DealerPlan>('full_portal');
  const [email, setEmail] = useState('');
  const [reload, setReload] = useState(0);
  const [testRecord, setTestRecord] = useState<{ customerName: string; message: string; reference: string } | null>(null);
  const [openingRecord, setOpeningRecord] = useState(false);
  const editable = status === 'draft';

  useEffect(() => {
    const controller = new AbortController();
    setPending('load');
    setError('');
    void customFetch<LaunchStatus>(endpoint, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setSetup(data);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(errorMessage(cause, 'Could not load the launch checks.'));
    }).finally(() => {
      if (!controller.signal.aborted) setPending(null);
    });
    return () => controller.abort();
  }, [endpoint, reload, refreshVersion]);

  function edit() {
    if (!setup) return;
    setPlan(setup.plan);
    setEmail(setup.enquiryEmail ?? '');
    setNotice('');
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !editable) return;
    setPending('save');
    setError('');
    try {
      const updated = await customFetch<LaunchStatus>(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, enquiryEmail: plan === 'website_only' ? email.trim() : null }),
      });
      setSetup(updated);
      setEditing(false);
      setTestRecord(null);
      setNotice('Plan settings saved.');
      await onUpdated();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save the plan settings.'));
    } finally { setPending(null); }
  }

  async function testEnquiry() {
    if (!setup || pending || editing || !editable) return;
    setPending('test');
    setError('');
    setNotice('');
    setTestRecord(null);
    try {
      const updated = await customFetch<LaunchStatus>(`${endpoint}/test-enquiry`, { method: 'POST' });
      setSetup(updated);
      setNotice(updated.plan === 'website_only'
        ? 'The email provider accepted the test. Check the dealership’s mailbox.'
        : 'The test enquiry is ready in the private Inbox preview.');
    } catch (cause) {
      setError(errorMessage(cause, 'Could not complete the test enquiry. Check the saved settings and try again.'));
    } finally { setPending(null); }
  }

  async function openTestRecord() {
    if (openingRecord || !setup?.testEnquiry?.enquiryId) return;
    setError('');
    setOpeningRecord(true);
    try {
      const result = await customFetch<{ enquiry: NonNullable<typeof testRecord> }>(`${endpoint}/test-enquiry`);
      setTestRecord(result.enquiry);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not open the test enquiry.'));
    } finally { setOpeningRecord(false); }
  }

  async function launch() {
    if (!editable || !setup?.ready || pending || editing) return;
    if (!window.confirm(`Publish ${dealerName} on its verified website address?`)) return;
    setPending('launch');
    setError('');
    setNotice('');
    try {
      const result = await customFetch<LaunchResult>(`${endpoint}/launch`, { method: 'POST' });
      setTestRecord(null);
      setNotice(`${dealerName} is live at ${new URL(result.origin).hostname}.`);
      await onUpdated();
    } catch (cause) {
      const updated = (cause as { data?: Partial<LaunchStatus> })?.data;
      if (updated?.plan && updated.checks && typeof updated.ready === 'boolean') setSetup(updated as LaunchStatus);
      setError(errorMessage(cause, 'Could not publish the dealership website.'));
    } finally { setPending(null); }
  }

  const ready = setup?.checks.filter(check => check.ready).length ?? 0;
  const heading = useId();
  const canTest = setup && (setup.plan === 'full_portal' || setup.enquiryEmail);
  return <section className="platform-go-live" aria-labelledby={heading}>
    <div className="platform-go-live-heading">
      <div>
        <h2 id={heading}>Launch checklist</h2>
        {setup && <p>{dealerPlans[setup.plan].label} · {ready} of {setup.checks.length} checks ready</p>}
      </div>
      {setup && !editing && editable && <Button variant="outline" disabled={!!pending} onClick={edit}>Edit plan</Button>}
    </div>
    {error && <p className="platform-alert" role="alert">{error}</p>}
    {notice && <p className="platform-notice" role="status">{notice}</p>}
    {pending === 'load' && !setup && <p role="status">Checking launch readiness…</p>}
    {!setup && error && <Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry checks</Button>}
    {editing && <form className="platform-launch-config" onSubmit={save}>
      <DealerPlanOptions value={plan} onChange={setPlan} disabled={!!pending} />
      {plan === 'website_only' && <label className="platform-field">
        <span>Enquiry email</span>
        <Input type="email" autoComplete="email" required value={email} disabled={!!pending} onChange={event => setEmail(event.target.value)} />
        <small>New website enquiries will be sent to this address.</small>
      </label>}
      <div className="platform-controls">
        <Button type="submit" disabled={!!pending}>Save plan</Button>
        <Button type="button" variant="ghost" disabled={!!pending} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </form>}
    {setup && !editing && <>
      <ol className="platform-launch-checks">
        {setup.checks.map(check => {
          const action = checkActions[check.id];
          return <li key={check.id} className="platform-launch-check">
            <span className="platform-launch-check-icon" data-ready={check.ready}>
              {check.ready ? <Check size={18} aria-hidden="true" /> : <action.Icon size={18} aria-hidden="true" />}
            </span>
            <div className="platform-launch-check-copy">
              <h3>{check.label}</h3>
              {check.detail && <p>{check.detail}</p>}
              {check.id === 'enquiry' && setup.testEnquiry?.reference && <p>Test reference {setup.testEnquiry.reference}</p>}
            </div>
            {!check.ready && action.tab && <Button variant="ghost" className="platform-launch-row-action" disabled={!!pending} onClick={() => onOpenTab(action.tab)}>{action.label}</Button>}
            {check.id === 'enquiry' && editable && <Button variant="outline" className="platform-launch-row-action" disabled={!!pending || !canTest} onClick={() => void testEnquiry()}>{pending === 'test' ? 'Running test…' : 'Run test enquiry'}</Button>}
            <span className="platform-launch-check-state" data-ready={check.ready}>{check.ready ? 'Ready' : 'To do'}</span>
          </li>;
        })}
      </ol>
      {editable && setup.testEnquiry?.enquiryId && <>
        {!testRecord && <Button variant="ghost" disabled={openingRecord || !!pending} onClick={() => void openTestRecord()}>{openingRecord ? 'Opening test…' : 'View test enquiry'}</Button>}
        {testRecord && <section className="platform-test-enquiry" aria-label="Fictional Inbox test enquiry">
          <div>
            <h3>{testRecord.customerName}</h3>
            <p>{testRecord.reference}</p>
          </div>
          <p>{testRecord.message}</p>
          <Button variant="ghost" onClick={() => setTestRecord(null)}>Hide test enquiry</Button>
        </section>}
      </>}
      {editable && <div className="platform-go-live-actions">
        <Button asChild variant="outline"><a href={`/platform/preview/${encodeURIComponent(dealerId)}`} target="_blank" rel="noopener noreferrer">Preview website <ArrowRight size={15} aria-hidden="true" /></a></Button>
        <Button disabled={!setup.ready || !!pending} onClick={() => void launch()}>{pending === 'launch' ? 'Publishing…' : 'Go live'}</Button>
      </div>}
    </>}
  </section>;
}
