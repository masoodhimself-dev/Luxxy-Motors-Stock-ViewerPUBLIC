import type { ReactNode } from "react";

type BadgeIcon = "mot" | "ulez" | "engine" | "owners" | "service";

// Drawn on one 24px grid, with the same stroke and optical margins.
const drawings: Record<BadgeIcon, ReactNode> = {
  mot: <><path d="M14 3H6v18h12V7Z M14 3v4h4" /><path d="m8.5 12 2 2 4-4 M9 17h6" /></>,
  ulez: <><path d="M19 4C11 3 5 7 5 12a6 6 0 0 0 6 6c5 0 8-6 8-14Z" /><path d="M4 21 14 11" /></>,
  engine: <><path d="M7 8h8l3 3h3v7h-4l-2 2H8l-3-3v-7h2Z M9 5h5 M11.5 5v3 M2 11v5 M2 13.5h3" /></>,
  owners: <><circle cx="12" cy="7" r="3.5" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></>,
  service: <><path d="M12 6C9 4 6 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z M12 6v14" /><path d="m15 10 1.5 1.5L19 9" /></>,
};

export function VehicleBadgeIcon({ kind }: { kind: BadgeIcon }) {
  return <svg className="vehicle-highlight-icon" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">{drawings[kind]}</svg>;
}
