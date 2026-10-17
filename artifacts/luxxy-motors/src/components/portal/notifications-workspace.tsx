import { useLocation, useSearch } from 'wouter';
import { Bell, CalendarDays, Inbox, Mail, MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { notificationHref, notificationView, type NotificationView } from '@/lib/notifications-navigation';
import { NotificationsHome } from './notifications-home';
import { EnquiriesPanel } from './enquiries-panel';
import { TestDriveBookingsPanel } from './test-drive-bookings-panel';
import { EmailWorkspace } from './email-workspace';
import { DeviceNotifications } from './device-notifications';
import './notifications-workspace.css';

const views = [
  { id: 'attention', label: 'Needs attention', description: 'Your next actions', icon: Inbox },
  { id: 'customers', label: 'Customers & enquiries', description: 'Conversations and follow-ups', icon: MessageSquare },
  { id: 'test-drives', label: 'Test drives', description: 'Bookings and calendar', icon: CalendarDays },
  { id: 'email', label: 'Email', description: 'Drafts and delivery', icon: Mail },
] as const;

export function NotificationsWorkspace({ canEmail }: { canEmail: boolean }) {
  const search = useSearch(), [,navigate] = useLocation(), params = new URLSearchParams(search);
  const view = notificationView(search), calendar = view === 'test-drives' && params.get('deskView') === 'calendar';
  function choose(next: NotificationView) { navigate(notificationHref(next, search)); }
  function newEnquiry() {
    navigate('/portal?section=notifications&workView=customers&deskView=new');
  }
  function openCustomer(id: string) {
    navigate(`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(id)}`);
  }
  return <section className="customer-notifications-workspace" data-calendar={calendar} aria-label="Customer notifications workspace">
    {!calendar && <header className="customer-workspace-heading"><div><p><Bell size={16} aria-hidden="true" />Your customer workspace</p><h2>Notifications</h2><span>Enquiries, test drives and email. One place to keep the conversation moving.</span></div><Button onClick={newEnquiry}><Plus size={17} aria-hidden="true" />New enquiry</Button></header>}
    <DeviceNotifications canEmail={canEmail} />
    <nav className="customer-workspace-views" aria-label="Notifications views">{views.filter(item=>item.id!=='email'||canEmail).map(item=>{const Icon=item.icon;return <button type="button" id={`customer-view-${item.id}`} key={item.id} aria-current={view===item.id?'page':undefined} aria-controls="customer-workspace-content" onClick={()=>choose(item.id)}><Icon size={19} aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>;})}</nav>
    <div id="customer-workspace-content" className="customer-workspace-content" role="region" aria-label={views.find(item=>item.id===view)?.label}>
      {view==='attention' && <NotificationsHome embedded />}
      {view==='customers' && <EnquiriesPanel embedded initialView="history" canEmail={canEmail} />}
      {view==='test-drives' && <>
        <div className="customer-diary-views" aria-label="Test-drive display"><Button variant={!calendar?'default':'outline'} aria-pressed={!calendar} onClick={()=>{const href=new URLSearchParams(notificationHref('test-drives',search).split('?')[1]);href.delete('deskView');navigate(`/portal?${href}`);}}>Bookings</Button><Button variant={calendar?'default':'outline'} aria-pressed={calendar} onClick={()=>navigate('/portal?section=notifications&workView=test-drives&deskView=calendar')}><CalendarDays size={16} aria-hidden="true" />Calendar</Button></div>
        {calendar ? <EnquiriesPanel key="calendar" embedded initialView="calendar" canEmail={canEmail} onOpenCustomer={openCustomer} /> : <TestDriveBookingsPanel canEmail={canEmail} enquiryId={params.get('enquiryId') || undefined} />}
      </>}
      {view==='email' && (canEmail ? <EmailWorkspace embedded /> : <div className="customer-workspace-denied" role="status"><h3>Email access isn’t included in your staff role</h3><p>You can still open customer enquiries and test drives.</p><Button variant="outline" onClick={()=>choose('attention')}>Back to needs attention</Button></div>)}
    </div>
  </section>;
}
