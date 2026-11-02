import { useLocation, useSearch } from 'wouter';
import { ArrowLeft, CalendarDays, Mail } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { notificationHref, notificationView, type NotificationView } from '@/lib/notifications-navigation';
import { EnquiriesPanel } from './enquiries-panel';
import { TestDriveBookingsPanel } from './test-drive-bookings-panel';
import { EmailWorkspace } from './email-workspace';
import { DeviceNotifications } from './device-notifications';
import './notifications-workspace.css';

export function NotificationsWorkspace({canEmail,onQuickEnquiry,onNewSale}: {
  canEmail:boolean;onQuickEnquiry?:()=>void;onNewSale?:()=>void;
}) {
  const search=useSearch(),[,navigate]=useLocation(),params=new URLSearchParams(search);
  const view=notificationView(search),calendar=view==='test-drives'&&params.get('deskView')==='calendar';
  function choose(next:NotificationView) { navigate(notificationHref(next,search)); }
  function openCustomer(id:string) { navigate(`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(id)}`); }
  const tools=<>
    <button type="button" onClick={()=>navigate('/portal?section=notifications&workView=test-drives&deskView=calendar')}><CalendarDays size={16} aria-hidden/>Calendar</button>
    {canEmail&&<button type="button" onClick={()=>choose('email')}><Mail size={16} aria-hidden/>Email records</button>}
  </>;
  return <section className="customer-notifications-workspace inbox-rebuilt" data-calendar={calendar} aria-label="Customer notifications workspace">
    {view==='customers' ? <EnquiriesPanel embedded initialView="history" canEmail={canEmail} inboxTools={tools} onQuickEnquiry={onQuickEnquiry}/>
    : <>
      <header className="inbox-secondary-heading">
        <Button variant="ghost" onClick={()=>choose('customers')}><ArrowLeft size={17} aria-hidden/>Back to Inbox</Button>
        <h2>{view==='test-drives'?'Test drives':'Email records'}</h2>
        <nav aria-label="Inbox tools">
          {view==='test-drives'&&<><Button variant={calendar?'ghost':'outline'} onClick={()=>navigate('/portal?section=notifications&workView=test-drives')}>Bookings</Button><Button variant={calendar?'outline':'ghost'} onClick={()=>navigate('/portal?section=notifications&workView=test-drives&deskView=calendar')}><CalendarDays size={16} aria-hidden/>Calendar</Button></>}
          {view!=='email'&&canEmail&&<Button variant="ghost" onClick={()=>choose('email')}><Mail size={16} aria-hidden/>Email records</Button>}
        </nav>
      </header>
      <div id="customer-workspace-content" className="customer-workspace-content" role="region" aria-label={view==='test-drives'?'Test drives':'Email records'}>
        {view==='test-drives'&&(calendar?<EnquiriesPanel key="calendar" embedded initialView="calendar" canEmail={canEmail} onOpenCustomer={openCustomer}/>:<TestDriveBookingsPanel canEmail={canEmail} enquiryId={params.get('enquiryId')||undefined}/>)}
        {view==='email'&&(canEmail?<EmailWorkspace embedded/>:<div role="status"><p>Email access isn’t included in your staff role.</p><Button variant="outline" onClick={()=>choose('customers')}>Back to Inbox</Button></div>)}
      </div>
    </>}
    <DeviceNotifications canEmail={canEmail}/>
  </section>;
}
