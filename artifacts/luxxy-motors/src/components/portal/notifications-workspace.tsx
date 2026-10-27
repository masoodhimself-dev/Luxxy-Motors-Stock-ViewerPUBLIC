import { useLocation, useSearch } from "wouter";
import { useEffect, useRef } from "react";
import {
  CalendarDays,
  Inbox,
  Mail,
  CustomerEnquiry,
  Plus,
  FileText,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  notificationHref,
  notificationView,
  type NotificationView,
} from "@/lib/notifications-navigation";
import { EnquiriesPanel } from "./enquiries-panel";
import { TestDriveBookingsPanel } from "./test-drive-bookings-panel";
import { EmailWorkspace } from "./email-workspace";
import { DeviceNotifications } from "./device-notifications";
import "./notifications-workspace.css";

const views = [
  {
    id: "customers",
    label: "Conversations",
    description: "Customers and follow-ups",
    icon: CustomerEnquiry,
    tone: "info",
  },
  {
    id: "test-drives",
    label: "Test drives",
    description: "Bookings and calendar",
    icon: CalendarDays,
    tone: "teal",
  },
  {
    id: "email",
    label: "Email records",
    description: "Drafts and delivery",
    icon: Mail,
    tone: "violet",
  },
] as const;

export function NotificationsWorkspace({
  canEmail,
  onQuickEnquiry,
  onNewSale,
}: {
  canEmail: boolean;
  onQuickEnquiry?: () => void;
  onNewSale?: () => void;
}) {
  const search = useSearch(),
    [, navigate] = useLocation(),
    params = new URLSearchParams(search);
  const view = notificationView(search),
    calendar = view === "test-drives" && params.get("deskView") === "calendar";
  const viewsNav = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = viewsNav.current;
    if (!nav) return;
    const reveal = () => {
      const current = nav.querySelector('[aria-current="page"]');
      if (!current) return;
      const item = current.getBoundingClientRect(),
        area = nav.getBoundingClientRect();
      if (item.left < area.left) nav.scrollLeft -= area.left - item.left;
      else if (item.right > area.right)
        nav.scrollLeft += item.right - area.right;
    };
    reveal();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [view, canEmail]);
  function choose(next: NotificationView) {
    navigate(notificationHref(next, search));
  }
  function newEnquiry() {
    if (onQuickEnquiry) onQuickEnquiry();
    else
      navigate("/portal?section=notifications&workView=customers&deskView=new");
  }
  function openCustomer(id: string) {
    navigate(
      `/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(id)}`,
    );
  }
  return (
    <section
      className="customer-notifications-workspace"
      data-calendar={calendar}
      aria-label="Customer notifications workspace"
    >
      {!calendar && (
        <header className="customer-workspace-heading">
          <h2>Inbox</h2>
          {canEmail && (
            <Button onClick={newEnquiry}>
              <Plus size={17} aria-hidden="true" />
              Quick enquiry
            </Button>
          )}
        </header>
      )}
      <nav
        ref={viewsNav}
        className="customer-workspace-views"
        aria-label="Notifications views"
      >
        {views
          .filter((item) => canEmail || item.id !== "email")
          .map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                id={`customer-view-${item.id}`}
                key={item.id}
                data-tone={item.tone}
                aria-current={view === item.id ? "page" : undefined}
                aria-controls="customer-workspace-content"
                onClick={() => choose(item.id)}
              >
                <Icon size={19} aria-hidden="true" />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            );
          })}
      </nav>
      <div
        id="customer-workspace-content"
        className="customer-workspace-content"
        role="region"
        aria-label={views.find((item) => item.id === view)?.label}
      >
        {view === "customers" && (
          <EnquiriesPanel embedded initialView="history" canEmail={canEmail} />
        )}
        {view === "test-drives" && (
          <>
            <div
              className="customer-diary-views"
              aria-label="Test-drive display"
            >
              <Button
                variant={!calendar ? "default" : "outline"}
                aria-pressed={!calendar}
                onClick={() => {
                  const href = new URLSearchParams(
                    notificationHref("test-drives", search).split("?")[1],
                  );
                  href.delete("deskView");
                  navigate(`/portal?${href}`);
                }}
              >
                Bookings
              </Button>
              <Button
                variant={calendar ? "default" : "outline"}
                aria-pressed={calendar}
                onClick={() =>
                  navigate(
                    "/portal?section=notifications&workView=test-drives&deskView=calendar",
                  )
                }
              >
                <CalendarDays size={16} aria-hidden="true" />
                Calendar
              </Button>
            </div>
            {calendar ? (
              <EnquiriesPanel
                key="calendar"
                embedded
                initialView="calendar"
                canEmail={canEmail}
                onOpenCustomer={openCustomer}
              />
            ) : (
              <TestDriveBookingsPanel
                canEmail={canEmail}
                enquiryId={params.get("enquiryId") || undefined}
              />
            )}
          </>
        )}
        {view === "email" &&
          (canEmail ? (
            <EmailWorkspace embedded />
          ) : (
            <div className="customer-workspace-denied" role="status">
              <h3>Email access isn’t included in your staff role</h3>
              <p>You can still open customer enquiries and test drives.</p>
              <Button variant="outline" onClick={() => choose("customers")}>
                Back to Inbox
              </Button>
            </div>
          ))}
      </div>
      <DeviceNotifications canEmail={canEmail} />
    </section>
  );
}
