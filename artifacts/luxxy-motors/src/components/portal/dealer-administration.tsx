import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, getGetDealerSettingsQueryKey } from '@workspace/api-client-react';
import { Link, useLocation, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { DealerSettingsPanel } from '@/components/dealer-settings-panel';
import { DealerIntegrationsSettings } from '@/components/dealer-integrations-settings';
import { EmailTemplatesSettings } from '@/components/email-templates-settings';
import { SalesPaperworkSettings } from '@/components/sales-paperwork-settings';
import { CustomerChatSettings } from '@/components/customer-chat-settings';
import './dealer-administration.css';

type Role = 'owner' | 'salesperson' | 'accounts';
type Access = { role: Role; permissions: string[]; user: { name?: string; email?: string } };
export function useStaffAccess(enabled = true) { return useQuery({ queryKey: ['staff-access'], queryFn: () => customFetch<Access>('/api/staff/access'), enabled, retry: false, staleTime: 60000 }); }
const request = <T,>(url: string, method = 'GET', body?: unknown) => customFetch<T>(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const money = (pence: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
const date = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(value));
const message = (error: unknown) => error instanceof Error ? error.message : 'This action could not be completed.';
function Feedback({ error }: { error: unknown }) { return error ? <p className="admin-error" role="alert">{message(error)}</p> : null; }

type Summary = {
  generatedAt: string; unansweredEnquiries: number; upcomingAppointments: number; pendingAppointments: number; overdueFollowUps: number;
  outstandingBalancePence: number; salesWithBalance: number; upcomingDeliveries: number; stockCount: number; completedSales: number;
  totalEnquiries: number; convertedEnquiries: number; enquiryConversionPercent: number; completedConversionPercent: number;
  stock: { lastSuccessfulSync: string | null; stale: boolean; alerts: { code: string; severity: string; message: string }[] };
  appointments: { id: string; customer: string; vehicle: string; at: string; status: string }[];
  balances: { id: string; reference: string; customer: string; balancePence: number }[];
  deliveries: { id: string; reference: string; customer: string; scheduledDate: string; timeWindow: string }[];
};
export function DealerDashboard() {
  const access = useStaffAccess();
  const query = useQuery({ queryKey: ['dealer-operations'], queryFn: () => request<Summary>('/api/dealer-operations'), refetchInterval: 60000 });
  const [exportError, setExportError] = useState(''), [exporting, setExporting] = useState(false);
  async function exportCsv() { setExporting(true); setExportError(''); try { const blob = await customFetch<Blob>('/api/dealer-operations/payments.csv', { responseType: 'blob' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `payment-ledger-${new Date().toISOString().slice(0,10)}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { setExportError(message(error)); } finally { setExporting(false); } }
  const data = query.data;
  return <section className="dealer-admin" aria-label="Dealership overview"><header className="admin-heading"><div><p className="admin-kicker">Your dealership</p><h2>Today at a glance</h2><p>Appointments, customer follow-ups and stock feed health in one place.</p></div><Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching ? 'Refreshing…' : 'Refresh overview'}</Button></header><Feedback error={query.error} />
    {!data ? <p role="status">{query.isLoading ? 'Loading overview…' : 'The overview is unavailable.'}</p> : <>
    <div className="admin-metrics">{[
      ['Enquiries awaiting a reply', data.unansweredEnquiries, '/portal?section=enquiries'], ['Upcoming appointments', data.upcomingAppointments, '/portal?section=test-drives'], ['Bookings to approve', data.pendingAppointments, '/portal?section=test-drives'], ['Overdue follow-ups', data.overdueFollowUps, '/portal?section=enquiries'],
      ['Cars in stock', data.stockCount, '/stock'], ['Completed sales', data.completedSales, '/portal?section=sales'], ['Outstanding balance', money(data.outstandingBalancePence), '/portal?section=sales'], ['Upcoming deliveries', data.upcomingDeliveries, '/portal?section=sales'],
    ].map(([label, value, url]) => <Link key={label} href={String(url)} className="admin-metric"><span>{label}</span><strong>{value}</strong></Link>)}</div>
    <div className="admin-columns"><article className="admin-card"><h3>Stock connection</h3><p className="admin-status">{data.stock.stale ? 'Stock feed needs attention' : 'Stock feed is current'}</p><p>{data.stock.lastSuccessfulSync ? `Last successful update: ${date(data.stock.lastSuccessfulSync)}` : 'No successful API import has been recorded.'}</p>{data.stock.alerts.map(alert => <p key={alert.code} className={alert.severity === 'error' ? 'admin-error' : 'admin-warning'}>{alert.message}</p>)}<Link href="/portal?section=settings" className="admin-text-link">Connection settings</Link></article>
    <article className="admin-card"><h3>Customer conversion</h3><div className="admin-stat"><strong>{data.completedConversionPercent}%</strong><span>Enquiries resulting in completed sales</span></div><p>{data.convertedEnquiries} of {data.totalEnquiries} enquiries have a linked sale file.</p><p className="admin-muted">Based on recorded enquiries and connected sales.</p></article></div>
    <div className="admin-columns"><article className="admin-card"><h3>Next appointments</h3>{data.appointments.length ? <ul className="admin-records">{data.appointments.slice(0,6).map(item => <li key={item.id}><strong>{item.customer}</strong><span>{item.vehicle}</span><span>{date(item.at)} · {item.status}</span></li>)}</ul> : <p>No upcoming appointments.</p>}<Link href="/portal?section=test-drives" className="admin-text-link">Open calendar</Link></article>
    <article className="admin-card"><h3>Payments and delivery</h3>{data.balances.length ? <ul className="admin-records">{data.balances.slice(0,5).map(item => <li key={item.id}><Link href={`/portal?section=sales&saleId=${item.id}`}><strong>{item.reference} · {item.customer}</strong></Link><span>{money(item.balancePence)} outstanding</span></li>)}</ul> : <p>No outstanding sale balances.</p>}{data.deliveries.slice(0,3).map(item => <p key={item.id}>{item.customer} · {item.scheduledDate} {item.timeWindow}</p>)}{access.data?.permissions.includes('finance.export') && <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting}>{exporting ? 'Preparing export…' : 'Export payment ledger'}</Button>}{exportError && <p className="admin-error" role="alert">{exportError}</p>}</article></div>
    <p className="admin-muted">Updated {date(data.generatedAt)} · London time</p></>}
  </section>;
}

type Member = { id: string; email: string | null; name: string | null; role: Role; active: boolean };
function TeamSettings() {
  const query = useQuery({ queryKey: ['staff-team'], queryFn: () => request<{ members: Member[] }>('/api/staff/team') });
  const [email, setEmail] = useState(''), [role, setRole] = useState<Role>('salesperson'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(url: string, method: string, body: unknown) { setBusy(true); setError(''); try { await request(url, method, body); setEmail(''); await query.refetch(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }
  return <section className="dealer-admin"><header className="admin-heading"><div><p className="admin-kicker">Staff access</p><h2>Your team</h2><p>Owners manage settings and integrations. Sales staff manage customers and sales. Accounts can export the payment ledger.</p></div></header><Feedback error={query.error} />{error && <p role="alert" className="admin-error">{error}</p>}<div className="admin-card"><form className="admin-inline-form" onSubmit={event => { event.preventDefault(); void save('/api/staff/team', 'POST', { email: email.trim(), role }); }}><label>Email<Input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label><label>Role<NativeSelect value={role} onChange={event => setRole(event.target.value as Role)}><option value="salesperson">Salesperson</option><option value="accounts">Accounts</option><option value="owner">Owner</option></NativeSelect></label><Button disabled={busy}>Add staff access</Button></form><p className="admin-muted">Staff sign in with their own account. The last active owner cannot be removed.</p></div><div className="admin-team-list">{query.data?.members.map(member => <article className="admin-card admin-team-member" key={member.id}><div><h3>{member.name ?? member.email ?? 'Staff member'}</h3>{member.name && <p>{member.email}</p>}<p className="admin-muted">{member.active ? 'Access enabled' : 'Access disabled'}</p></div><label>Role<NativeSelect aria-label={`Role for ${member.email ?? member.id}`} disabled={busy} value={member.role} onChange={event => void save(`/api/staff/team/${member.id}`, 'PATCH', { role: event.target.value })}><option value="owner">Owner</option><option value="salesperson">Salesperson</option><option value="accounts">Accounts</option></NativeSelect></label><Button disabled={busy} variant="outline" onClick={() => { if (window.confirm(`${member.active ? 'Disable' : 'Enable'} access for ${member.email ?? member.name}?`)) void save(`/api/staff/team/${member.id}`, 'PATCH', { active: !member.active }); }}>{member.active ? 'Disable access' : 'Enable access'}</Button></article>)}</div></section>;
}
type Version = { revision: number; publishedAt: string; publishedBy: string; action: string; restoredFrom?: number };
function PublicationHistory() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ['settings-history'], queryFn: () => request<{ revision: number; versions: Version[] }>('/api/staff/settings-history') });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function restore(version: Version) { if (!query.data || !window.confirm(`Restore website settings from version ${version.revision}? This creates a new published version. Reservations and sales are unchanged.`)) return; setBusy(true); setError(''); try { await customFetch(`/api/staff/settings-history/${version.revision}/restore`, { method: 'POST', headers: { 'If-Match': String(query.data.revision), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: query.data.revision }) }); await query.refetch(); await cache.invalidateQueries({ queryKey: getGetDealerSettingsQueryKey() }); setNotice(`Version ${version.revision} restored as a new publication.`); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }
  return <section className="dealer-admin"><header className="admin-heading"><div><p className="admin-kicker">Website publishing</p><h2>Publication history</h2><p>Review who published each version and restore an earlier website configuration.</p></div><Button variant="outline" disabled={busy || query.isFetching} onClick={() => void query.refetch()}>Refresh history</Button></header><Feedback error={query.error} />{error && <p role="alert" className="admin-error">{error}</p>}{notice && <p role="status">{notice}</p>}<div className="admin-team-list">{query.data?.versions.map(version => <article className="admin-card admin-version" key={version.revision}><div><h3>Version {version.revision} {version.revision === query.data?.revision && <span className="admin-current">Current</span>}</h3><p>{date(version.publishedAt)} · {version.publishedBy}</p><p className="admin-muted">{version.action === 'restore' ? `Restored from version ${version.restoredFrom}` : version.action === 'initial' ? 'Initial configuration' : 'Website settings published'}</p></div>{version.revision !== query.data?.revision && <Button variant="outline" disabled={busy} onClick={() => void restore(version)}>Restore this version</Button>}</article>)}</div></section>;
}
export function DealerSettingsHub() {
  const access = useStaffAccess(); const search = useSearch(); const [,navigate] = useLocation(); const [section, setSection] = useState(() => new URLSearchParams(search).get('settingsTab') ?? 'website');
  useEffect(() => { const id = new URLSearchParams(search).get('settingsTab') ?? 'website'; setSection(['website','emails','integrations','paperwork','chat','team','history'].includes(id) ? id : 'website'); }, [search]);
  if (access.isLoading) return <p role="status">Loading settings access…</p>;
  if (access.isError) return <Feedback error={access.error} />;
  if (!access.data?.permissions.includes('settings.publish')) return <div className="admin-card"><h2>Owner settings</h2><p>Your role does not have permission to publish dealership settings.</p></div>;
  const sections = [
    ['website','Website','Branding, showroom details, pages, bookings and customer services. Review the website draft before publishing.'],
    ['emails','Email templates','Customise messages and email branding. Save templates separately; previews send no email.'],
    ['integrations','Email & payments','Private Resend and Stripe connections for this dealership. Validate saved configuration before testing with the provider.'],
    ['paperwork','Sales documents','Invoice design, reference sequences and approved sale/deposit wording. Existing issued copies stay unchanged.'],
    ['chat','Website chat','Customer chat availability, automatic answers and welcome messages.'],
    ['team','Team','Manage individual staff access and roles. Keep at least one active owner.'],
    ['history','Publish history','Review and restore website publications. Private connections, email templates and sales terms are saved separately.'],
  ];
  return <div className="dealer-settings-hub"><nav className="admin-settings-tabs" aria-label="Dealership settings">{sections.map(([id,label]) => <button type="button" key={id} aria-current={section === id ? 'page' : undefined} onClick={() => { setSection(id); navigate(`/portal?section=settings&settingsTab=${id}`); }}>{label}</button>)}</nav><p className="settings-category-description" role="status">{sections.find(([id]) => id === section)?.[2]}</p><div key={section}>{section === 'website' && <DealerSettingsPanel />}{section === 'emails' && <EmailTemplatesSettings />}{section === 'integrations' && <DealerIntegrationsSettings />}{section === 'paperwork' && <div className="integration-settings"><SalesPaperworkSettings /></div>}{section === 'chat' && <CustomerChatSettings />}{section === 'team' && <TeamSettings />}{section === 'history' && <PublicationHistory />}</div></div>;
}
