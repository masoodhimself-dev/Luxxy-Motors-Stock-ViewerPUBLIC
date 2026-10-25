import { AccountInvitations } from '@/components/account-invitations';
import { Bell, Globe2, Mail, PlugZap, FileText, Users, History, MessageCircle, SlidersHorizontal, ShieldCheck, CarFront, Wallet, Store, CalendarDays, QrCode } from '@/components/icons';
import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, getGetDealerSettingsQueryKey } from '@workspace/api-client-react';
import { Link, useLocation, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { SettingsTabs } from '@/components/settings-tabs';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { DealerSettingsPanel } from '@/components/dealer-settings-panel';
import { DealerIntegrationsSettings } from '@/components/dealer-integrations-settings';
import { EmailTemplatesSettings } from '@/components/email-templates-settings';
import { SalesPaperworkSettings } from '@/components/sales-paperwork-settings';
import { CustomerChatSettings } from '@/components/customer-chat-settings';
import { SearchVisibilitySettings } from '@/components/search-visibility-settings';
import { StockChangeSettings } from '@/components/stock-change-settings';
import { VehicleWatchSettings } from '@/components/vehicle-watch-settings';
import { PhoneSharingSettings } from '@/components/phone-sharing-settings';
import { customerFeaturePolicy } from '@workspace/vehicle-meta';
import './dealer-administration.css';

type Role = 'owner' | 'salesperson' | 'accounts';
type Access = { role: Role; permissions: string[]; user: { authUserId?: string; name?: string; email?: string } };
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
export function DealerDashboard({
  compact = false,
  children,
}: { compact?: boolean; children?: ReactNode } = {}) {
  const access = useStaffAccess();
  const query = useQuery({
    queryKey: ['dealer-operations'],
    queryFn: () => request<Summary>('/api/dealer-operations'),
    refetchInterval: 60000,
    retry: false,
  });
  const [exportError, setExportError] = useState(''),
    [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    setExportError('');
    try {
      const blob = await customFetch<Blob>(
        '/api/dealer-operations/payments.csv',
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `payment-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(message(error));
    } finally {
      setExporting(false);
    }
  }
  const data = query.data;
  const records = data && (
    <div className="admin-columns">
      <article className="admin-card">
        <h3>Next appointments</h3>
        {data.appointments.length ? (
          <ul className="admin-records">
            {data.appointments.slice(0, 6).map((item) => (
              <li key={item.id}>
                <Link
                  href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(item.id)}`}
                >
                  <strong>{item.customer}</strong>
                  <span>{item.vehicle}</span>
                  <span>
                    {date(item.at)} · {item.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No upcoming appointments.</p>
        )}
        <Link
          href="/portal?section=notifications&workView=test-drives&deskView=calendar"
          className="admin-text-link"
        >
          Open calendar
        </Link>
      </article>
      <article className="admin-card">
        <h3>Payments</h3>
        <div className="admin-task-totals">
          <Link href="/portal?section=sales">
            <span>Outstanding balance</span>
            <strong>{money(data.outstandingBalancePence)}</strong>
          </Link>
          {data.upcomingDeliveries > 0 && (
            <Link href="/portal?section=sales">
              <span>Upcoming deliveries</span>
              <strong>{data.upcomingDeliveries}</strong>
            </Link>
          )}
        </div>
        {data.balances.length ? (
          <ul className="admin-records">
            {data.balances.slice(0, 5).map((item) => (
              <li key={item.id}>
                <Link
                  href={`/portal?section=sales&saleId=${encodeURIComponent(item.id)}`}
                >
                  <strong>
                    {item.customer}
                  </strong>
                  <span>{money(item.balancePence)} outstanding</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No outstanding sale balances.</p>
        )}
        {data.deliveries.slice(0, 3).map((item) => (
          <p key={item.id}>
            <Link
              href={`/portal?section=sales&saleId=${encodeURIComponent(item.id)}`}
            >
              {item.customer} · {item.scheduledDate} {item.timeWindow}
            </Link>
          </p>
        ))}
        {access.data?.permissions.includes('finance.export') && (
          <Button
            variant="outline"
            onClick={() => void exportCsv()}
            disabled={exporting}
          >
            {exporting ? 'Preparing export…' : 'Export payment ledger'}
          </Button>
        )}
        {exportError && (
          <p className="admin-error" role="alert">
            {exportError}
          </p>
        )}
      </article>
    </div>
  );
  const reporting = data && (
    <div className="admin-columns">
      <article className="admin-card">
        <h3>Stock connection</h3>
        <p className="admin-status" data-state={data.stock.stale ? 'warning' : 'success'}>
          {data.stock.stale
            ? 'Stock feed needs attention'
            : 'Stock feed is current'}
        </p>
        <p>
          {data.stock.lastSuccessfulSync
            ? `Last successful update: ${date(data.stock.lastSuccessfulSync)}`
            : 'No successful API import has been recorded.'}
        </p>
        <p className="admin-muted">Stock connections are managed by the platform operator. {access.data?.role === 'owner' ? 'Contact your platform operator about a failed or outdated import.' : 'Ask your owner to report a failed or outdated import.'}</p>
      </article>
      <article className="admin-card">
        <h3>Customer conversion</h3>
        <div className="admin-stat">
          <strong>{data.completedConversionPercent}%</strong>
          <span>Enquiries resulting in completed sales</span>
        </div>
        <p>
          {data.convertedEnquiries} of {data.totalEnquiries} enquiries have a
          linked sale file.
        </p>
        <p className="admin-muted">
          Based on recorded enquiries and connected sales.
        </p>
        <Link href="/portal?section=sales" className="admin-text-link">
          Completed sales · {data.completedSales}
        </Link>
      </article>
    </div>
  );
  const stockAttention = data &&
    (data.stock.stale || data.stock.alerts.length > 0) && (
      <div className="admin-attention" aria-label="Stock needing attention">
        {data.stock.stale && (!compact || !data.stock.alerts.length) && (
          <p className="admin-warning">
            Stock feed needs attention. Check the last successful update below.
          </p>
        )}
        {data.stock.alerts.map((alert) => (
          <p
            key={alert.code}
            className={
              alert.severity === 'error' ? 'admin-error' : 'admin-warning'
            }
          >
            {alert.message}
          </p>
        ))}
      </div>
    );
  if (compact)
    return (
      <section
        className="dealer-admin dealer-overview dealer-overview-compact"
        aria-label="Daily dealership summary"
      >
        {query.isError && (
          <div className="admin-summary-error" role="alert">
            <p>
              Dealership summary could not be refreshed.
              {data ? ' The last loaded figures are shown.' : ''}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              Retry summary
            </Button>
          </div>
        )}
        {children}
        {!data ? (
          query.isLoading && (
            <p role="status" className="admin-muted">
              Loading dealership summary…
            </p>
          )
        ) : (
          <>
            <div
              className="admin-daily-summary"
              role="group"
              aria-label="Dealership figures"
            >
              <Link href="/portal?section=inventory" data-tone="teal">
                <CarFront aria-hidden size={19} />
                <span>Cars in stock</span>
                <strong>{data.stockCount}</strong>
              </Link>
              <Link href="/portal?section=sales" data-tone={data.outstandingBalancePence > 0 ? 'warning' : 'success'}>
                <Wallet aria-hidden size={19} />
                <span>Outstanding balance</span>
                <strong>{money(data.outstandingBalancePence)}</strong>
              </Link>
            </div>
            {stockAttention}
          </>
        )}
        {data && (
          <details className="admin-overview-details admin-daily-details">
            <summary>
              More dealership details
              <span>Appointments, payments and stock connection</span>
            </summary>
            {records}
            {reporting}
            <p className="admin-muted admin-details-updated">
              Updated {date(data.generatedAt)} · London time
            </p>
          </details>
        )}
      </section>
    );
  return (
    <section
      className="dealer-admin dealer-overview"
      aria-label="Dealership overview"
    >
      <header className="admin-heading">
        <div>
          <p className="admin-kicker">Your dealership</p>
          <h2>Today at a glance</h2>
          <p>
            Customers to help, appointments to prepare and payments to finish.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? 'Refreshing…' : 'Refresh overview'}
        </Button>
      </header>
      <Feedback error={query.error} />
      {!data ? (
        <p role="status">
          {query.isLoading
            ? 'Loading overview…'
            : 'The overview is unavailable.'}
        </p>
      ) : (
        <>
          <div className="admin-metrics">
            {[
              [
                'Enquiries awaiting a reply',
                data.unansweredEnquiries,
                '/portal?section=notifications&workView=customers',
              ],
              [
                'Upcoming appointments',
                data.upcomingAppointments,
                '/portal?section=notifications&workView=test-drives',
              ],
              [
                'Overdue follow-ups',
                data.overdueFollowUps,
                '/portal?section=notifications&workView=customers',
              ],
              ['Cars in stock', data.stockCount, '/portal?section=inventory'],
            ].map(([label, value, url]) => (
              <Link key={label} href={String(url)} className="admin-metric">
                <span>{label}</span>
                <strong>{value}</strong>
              </Link>
            ))}
          </div>
          {data.pendingAppointments > 0 && (
            <Link
              href="/portal?section=notifications&workView=test-drives"
              className="admin-attention-link"
            >
              <strong>
                {data.pendingAppointments}{' '}
                {data.pendingAppointments === 1
                  ? 'booking needs'
                  : 'bookings need'}{' '}
                approval
              </strong>
              <span>Review appointments →</span>
            </Link>
          )}
          {stockAttention}
          {records}
          <details className="admin-overview-details">
            <summary>
              More dealership details
              <span>Stock connection and sales performance</span>
            </summary>
            {reporting}
          </details>
          <p className="admin-muted">
            Updated {date(data.generatedAt)} · London time
          </p>
        </>
      )}
    </section>
  );
}

type Member = { id: string; email: string | null; name: string | null; role: Role; active: boolean };
function TeamSettings() {
  const query = useQuery({ queryKey: ['staff-team'], queryFn: () => request<{ members: Member[] }>('/api/staff/team') });
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pendingRoles = query.data?.members.some(member => roles[member.id] && roles[member.id] !== member.role) ?? false;
  async function save(url: string, method: string, body: unknown) {
    setBusy(true); setError(''); setNotice('');
    try {
      await request(url, method, body);
      if (url.startsWith('/api/staff/team/') && body && typeof body === 'object' && 'role' in body) setRoles(current => { const next = { ...current }; delete next[url.split('/').at(-1)!]; return next; });
      await query.refetch();
      setNotice('Team access updated.');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <section className="dealer-admin" data-settings-dirty={pendingRoles}>
    <header className="admin-heading"><div><h2>Your team</h2><p>Give each member of staff their own account and the access they need.</p></div></header>
    <Feedback error={query.error} />{error && <p role="alert" className="admin-error">{error}</p>}{notice && <p role="status" className="integration-notice">{notice}</p>}
    <details className="admin-role-help"><summary>What each role can do</summary><ul><li><strong>Owner:</strong> dealership settings, team access, customers and sales.</li><li><strong>Salesperson:</strong> stock, customer enquiries, appointments and sales.</li><li><strong>Accounts:</strong> record and refund payments, view sales and export the payment ledger.</li></ul></details>
    <AccountInvitations />
    <p className="admin-muted">Staff sign in with their own account. The last active owner cannot be removed.</p>
    <div className="admin-team-list">{query.isLoading && <p role="status" className="admin-muted">Loading team access…</p>}{query.data?.members.length === 0 && <p className="admin-card admin-muted">No staff access records to show.</p>}
      {query.data?.members.map(member => {
        const nextRole = roles[member.id] ?? member.role, changed = nextRole !== member.role;
        return <article className="admin-card admin-team-member" key={member.id}>
          <div><h3>{member.name ?? member.email ?? 'Staff member'}</h3>{member.name && <p>{member.email}</p>}<p className="admin-muted">{member.active ? 'Access enabled' : 'Access disabled'}</p></div>
          <div className="admin-team-role"><label>Role<NativeSelect aria-label={`Role for ${member.email ?? member.id}`} disabled={busy} value={nextRole} onChange={event => setRoles(current => ({ ...current, [member.id]: event.target.value as Role }))}><option value="owner">Owner</option><option value="salesperson">Salesperson</option><option value="accounts">Accounts</option></NativeSelect></label><Button disabled={busy || !changed} onClick={() => void save(`/api/staff/team/${member.id}`, 'PATCH', { role: nextRole })}>Apply role</Button></div>
          <Button disabled={busy} variant="outline" onClick={() => { if (window.confirm(`${member.active ? 'Disable' : 'Enable'} access for ${member.email ?? member.name}?`)) void save(`/api/staff/team/${member.id}`, 'PATCH', { active: !member.active }); }}>{member.active ? 'Disable access' : 'Enable access'}</Button>
        </article>;
      })}
    </div>
  </section>;
}
type Version = { revision: number; publishedAt: string; publishedBy: string; action: string; restoredFrom?: number };
function PublicationHistory() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ['settings-history'], queryFn: () => request<{ revision: number; versions: Version[] }>('/api/staff/settings-history') });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function restore(version: Version) { if (!query.data || !window.confirm(`Restore website settings from version ${version.revision}? This creates a new published version. Reservations and sales are unchanged.`)) return; setBusy(true); setError(''); try { await customFetch(`/api/staff/settings-history/${version.revision}/restore`, { method: 'POST', headers: { 'If-Match': String(query.data.revision), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: query.data.revision }) }); await query.refetch(); await cache.invalidateQueries({ queryKey: getGetDealerSettingsQueryKey() }); setNotice(`Version ${version.revision} restored as a new publication.`); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }
  return <section className="dealer-admin"><header className="admin-heading"><div><p className="admin-kicker">Website publishing</p><h2>Publication history</h2><p>Review who published each version and restore an earlier website configuration.</p></div><Button variant="outline" disabled={busy || query.isFetching} onClick={() => void query.refetch()}>Refresh history</Button></header><Feedback error={query.error} />{error && <p role="alert" className="admin-error">{error}</p>}{notice && <p role="status">{notice}</p>}<div className="admin-team-list">{query.isLoading && <p role="status" className="admin-muted">Loading publication history…</p>}{query.data?.versions.length === 0 && <p className="admin-card admin-muted">No website publications have been recorded yet.</p>}{query.data?.versions.map(version => <article className="admin-card admin-version" key={version.revision}><div><h3>Version {version.revision} {version.revision === query.data?.revision && <span className="admin-current">Current</span>}</h3><p>{date(version.publishedAt)} · {version.publishedBy}</p><p className="admin-muted">{version.action === 'restore' ? `Restored from version ${version.restoredFrom}` : version.action === 'initial' ? 'Initial configuration' : 'Website settings published'}</p></div>{version.revision !== query.data?.revision && <Button variant="outline" disabled={busy} onClick={() => void restore(version)}>Restore this version</Button>}</article>)}</div></section>;
}
export function DealerSettingsHub() {
  const editorRoot = useRef<HTMLDivElement>(null);
  const access = useStaffAccess();
  const search = useSearch();
  const [, navigate] = useLocation();
  const requested = new URLSearchParams(search).get('settingsTab') ?? 'dealership';
  const canTeam = access.data?.permissions.includes('team.manage') ?? false;
  const allowed = ['dealership', 'website', 'bookings', 'emails', 'paperwork', 'sharing', 'stock-updates', 'watch', 'team', 'integrations', 'search', 'history', ...(customerFeaturePolicy.websiteChat ? ['chat'] : [])];
  const legacySection = new URLSearchParams(search).get('websiteSection');
  const selectedSection = requested === 'website' && ['contact','legal'].includes(legacySection ?? '') ? 'dealership' : requested === 'website' && legacySection === 'bookings' ? 'bookings' : allowed.includes(requested) ? requested : 'dealership';
  const dealerGroup = ['dealership', 'website', 'bookings'].includes(selectedSection);
  const primary = ['emails', 'paperwork', 'sharing', 'stock-updates', 'watch'].includes(selectedSection) ? 'documents' : selectedSection === 'history' ? 'website' : ['integrations', 'search', 'chat'].includes(selectedSection) ? 'advanced' : selectedSection;
  const primaryTabs = [
    { id: 'dealership', label: 'Dealership details', icon: Store },
    { id: 'website', label: 'Website', icon: Globe2 },
    { id: 'bookings', label: 'Bookings', icon: CalendarDays },
    { id: 'documents', label: 'Emails & documents', icon: Mail },
    ...(canTeam ? [{ id: 'team', label: 'Team & access', icon: Users }] : []),
    { id: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
  ];
  function chooseSection(id: string) {
    if (id === selectedSection) return;
    // All three areas edit one complete, locally retained website draft.
    if (!dealerGroup && editorRoot.current?.querySelector('[data-settings-dirty="true"]') &&
      !window.confirm('This settings area has unsaved changes. Leave it and discard those changes?')) return;
    navigate(`/portal?section=settings&settingsTab=${id}`);
  }
  if (access.isLoading) return <p role="status">Loading settings access…</p>;
  if (access.isError) return <Feedback error={access.error} />;
  if (!access.data?.permissions.includes('settings.publish')) return <div className="admin-card"><h2>Owner settings</h2><p>Your role does not have permission to publish dealership settings.</p></div>;
  const secondary = primary === 'documents' ? [
    { id: 'emails', label: 'Email templates', icon: Mail },
    { id: 'paperwork', label: 'Invoices & terms', icon: FileText },
    { id: 'sharing', label: 'WhatsApp & QR', icon: QrCode },
    { id: 'stock-updates', label: 'Price updates', icon: CarFront },
    { id: 'watch', label: 'Watch this car', icon: Bell },
  ] : primary === 'advanced' ? [
    { id: 'integrations', label: 'Connections', icon: PlugZap },
    { id: 'search', label: 'Search visibility', icon: Globe2 },
    ...(customerFeaturePolicy.websiteChat ? [{ id: 'chat', label: 'Website chat', icon: MessageCircle }] : []),
  ] : [];
  const panelId = primaryTabs.some(tab => tab.id === primary) ? primary : 'team';
  return <section className="dealer-settings-hub settings-hub-redesign settings-tabs-workspace" aria-label="Dealership settings">
    <header className="settings-tabs-heading"><div><h2>Settings</h2><p>Your dealership details, website and staff preferences.</p></div><span><ShieldCheck size={15} aria-hidden="true" />Owner access</span></header>
    <div className="settings-primary-navigation"><SettingsTabs idPrefix="dealer-settings" label="Settings categories" value={primary} items={primaryTabs} onValueChange={id => chooseSection(id === 'advanced' ? 'integrations' : id === 'documents' ? 'emails' : id)} /></div>
    <div ref={editorRoot} id={`dealer-settings-panel-${panelId}`} role="tabpanel" aria-labelledby={canTeam || primary !== 'team' ? `dealer-settings-tab-${panelId}` : undefined} aria-label={!canTeam && primary === 'team' ? 'Team access' : undefined} className="settings-hub-content">
      {secondary.length > 0 && <div className="settings-secondary-navigation"><SettingsTabs idPrefix="settings-area" label={primary === 'documents' ? 'Emails and documents' : 'Advanced settings'} value={selectedSection} items={secondary} onValueChange={chooseSection} /></div>}
      <div {...(secondary.length ? { role: 'tabpanel', id: `settings-area-panel-${selectedSection}`, 'aria-labelledby': `settings-area-tab-${selectedSection}` } : {})}>
      {/* One stable editor instance keeps all website draft fields across groups. */}
      {dealerGroup && <DealerSettingsPanel group={selectedSection as 'dealership' | 'website' | 'bookings'} />}
      {selectedSection === 'history' && <><Button variant="outline" onClick={() => navigate('/portal?section=settings&settingsTab=website&websiteSection=review')}>Back to review & publish</Button><PublicationHistory /></>}
      {selectedSection === 'emails' && <EmailTemplatesSettings />}
      {selectedSection === 'paperwork' && <div className="integration-settings"><SalesPaperworkSettings /></div>}
      {selectedSection === 'sharing' && <PhoneSharingSettings />}
      {selectedSection === 'stock-updates' && <StockChangeSettings />}
      {selectedSection === 'watch' && <VehicleWatchSettings />}
      {selectedSection === 'team' && (canTeam ? <TeamSettings /> : <div className="settings-access-note" role="status"><h3>Team access is managed by an authorised owner</h3><p>Your account cannot change staff access. Choose another settings tab to continue.</p></div>)}
      {selectedSection === 'integrations' && <DealerIntegrationsSettings />}
      {selectedSection === 'search' && <SearchVisibilitySettings />}
      {selectedSection === 'chat' && <CustomerChatSettings />}
      </div>
    </div>
  </section>;
}
