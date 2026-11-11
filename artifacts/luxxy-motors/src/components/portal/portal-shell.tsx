import type { ReactNode } from "react";
import { DealerWordmark } from "@/components/brand/wordmark";
import {
  CalendarDays,
  CarFront,
  CustomerEnquiry,
  ExternalLink,
  House,
  MoreHorizontal,
  Sale,
  Settings2,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { isMultiChoiceWebsite } from "@/lib/multi-home-scope";
import { WorkspaceSearch } from "./workspace-tools";
import "./portal-shell.css";

export const portalSections = {
  today: { label: "Today", icon: House },
  notifications: { label: "Inbox", icon: CustomerEnquiry },
  cars: { label: "Stock", icon: CarFront },
  sales: { label: "Sales", icon: Sale },
  calendar: { label: "Calendar", icon: CalendarDays },
  settings: { label: "Settings", icon: Settings2 },
} as const;

export type PortalSection = keyof typeof portalSections;
const mainSections = ["today", "notifications", "cars", "sales", "calendar"] as const;

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function PortalMark() {
  return (
    <>
      <span className="portal-desk-mark" aria-hidden="true">
        <span /><span /><span />
      </span>
      <span className="portal-desk-wordmark">Dealer<span>OS</span></span>
    </>
  );
}

type PortalShellProps = {
  section: PortalSection;
  staffName: string;
  staffRole?: string;
  canOpenSettings: boolean;
  inboxCount?: number;
  onNavigate: (section: PortalSection) => void;
  account?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export function PortalShell({
  section,
  staffName,
  staffRole,
  canOpenSettings,
  inboxCount,
  onNavigate,
  account,
  actions,
  children,
}: PortalShellProps) {
  const { settings } = useDealerSettings();
  const dealerName = settings.identity.name || "Dealership";
  const logoAsset = isMultiChoiceWebsite()
    ? "/brand/multi-choice-motors/multi-choice-wordmark.svg"
    : settings.identity.logoAsset;
  const moreIsCurrent = section === "calendar" || section === "settings";

  function sectionButton(key: PortalSection) {
    const { label, icon: Icon } = portalSections[key];
    return (
      <button
        type="button"
        key={key}
        className="portal-desk-link"
        id={`portal-section-${key}`}
        data-testid={`tab-${key}`}
        data-destination={key}
        aria-controls={`portal-content-${key}`}
        aria-current={section === key ? "page" : undefined}
        aria-description={key === "notifications" && inboxCount ? `${inboxCount} to review` : undefined}
        onClick={() => onNavigate(key)}
      >
        <Icon size={19} aria-hidden="true" />
        <span>{label}</span>
        {key === "notifications" && !!inboxCount && (
          <span className="portal-desk-count" aria-hidden="true">
            {inboxCount > 99 ? "99+" : inboxCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="portal-workspace-inner portal-app-layout portal-desk-shell">
      <aside className="portal-desk-rail" aria-label="Workspace navigation">
        <button className="portal-desk-brand" type="button" onClick={() => onNavigate("today")} aria-label="DealerOS home">
          <PortalMark />
        </button>
        <div className="portal-desk-dealer">
          <span className="portal-desk-dealer-logo" aria-hidden="true">
            {logoAsset
              ? <DealerWordmark {...settings.identity} logoAsset={logoAsset} />
              : initials(dealerName)}
          </span>
          <strong>{dealerName}</strong>
        </div>
        <nav className="portal-desk-nav portal-section-nav" aria-label="Portal sections">
          {mainSections.map(sectionButton)}
          <div className="portal-desk-more">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="portal-desk-link"
                  aria-current={moreIsCurrent ? "page" : undefined}
                >
                  <MoreHorizontal size={19} aria-hidden="true" />
                  <span>More</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="top"
                sideOffset={9}
                collisionPadding={9}
                className="portal-quick-menu"
                aria-label="More workspace destinations"
              >
                <DropdownMenuItem onSelect={() => onNavigate("calendar")} aria-current={section === "calendar" ? "page" : undefined}>
                  <CalendarDays size={18} aria-hidden="true" /> Calendar
                </DropdownMenuItem>
                {canOpenSettings && (
                  <DropdownMenuItem onSelect={() => onNavigate("settings")} aria-current={section === "settings" ? "page" : undefined}>
                    <Settings2 size={18} aria-hidden="true" /> Settings
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <a href="/" target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={17} aria-hidden="true" /> View showroom
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
        <div className="portal-desk-rail-foot">
          {canOpenSettings && sectionButton("settings")}
          <div className="portal-desk-user">
            <span className="portal-desk-avatar" aria-hidden="true">{initials(staffName)}</span>
            <div><strong>{staffName}</strong>{staffRole && <small>{staffRole}</small>}</div>
          </div>
        </div>
      </aside>
      <div className="portal-desk-body">
        <header className="portal-toolbar portal-desk-toolbar" aria-label="Staff workspace">
          <button
            type="button"
            className="portal-desk-brand portal-desk-brand-mobile"
            onClick={() => onNavigate("today")}
            aria-label={`DealerOS home for ${dealerName}`}
          >
            <PortalMark />
            <small>{dealerName}</small>
          </button>
          <WorkspaceSearch appearance="desk" />
          <div className="portal-toolbar-actions portal-desk-actions">
            {actions}
            <a
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="portal-desk-showroom"
              aria-label="View showroom (opens in a new tab)"
              title="View showroom in a new tab"
            >
              <ExternalLink size={17} aria-hidden="true" />
            </a>
            {account && <div className="portal-account" aria-label="Staff account">{account}</div>}
          </div>
        </header>
        <h1 className="sr-only">Dealership workspace</h1>
        <div className="portal-main-area min-w-0">{children}</div>
      </div>
    </div>
  );
}
