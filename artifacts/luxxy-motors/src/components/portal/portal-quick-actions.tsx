import { useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  CustomerEnquiry,
  FilePenLine,
  LayoutGrid,
  Mail,
  Plus,
  Sale,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type QuickActionVehicle = {
  id: string;
  title: string;
  registration: string;
  canBook: boolean;
  canStartSale: boolean;
};
type DraftQueueSummary = { drafts: { enquiryId: string }[]; hasMore: boolean };

export function PortalQuickActions({
  canManage,
  bookingEnabled,
  variant = "quick",
  vehicle,
  triggerRef,
  onEnquiry,
  onSale,
  onPracticeSale,
  onWriteLetter,
  onWriteEmail,
  onMot,
  onCalendar,
  onDrafts,
}: {
  canManage: boolean;
  bookingEnabled: boolean;
  variant?: "quick" | "new";
  vehicle?: QuickActionVehicle;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onEnquiry: (vehicleId?: string, bookTestDrive?: boolean) => void;
  onSale: (vehicleId?: string) => void;
  onPracticeSale?: () => void;
  onWriteLetter?: () => void;
  onWriteEmail?: () => void;
  onMot: () => void;
  onCalendar: () => void;
  onDrafts: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Share the inbox's cache and load only when staff actually open the menu.
  const drafts = useQuery({
    queryKey: ["staff-email-drafts", "all"],
    queryFn: ({ signal }) =>
      customFetch<DraftQueueSummary>("/api/staff/email-drafts", { signal }),
    enabled: open && canManage,
    staleTime: 30_000,
    retry: false,
  });
  const draftCount = !drafts.isError && drafts.data?.drafts.length;
  const label = variant === "new" ? canManage ? "New" : "Tools" : "Quick actions";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          className="portal-quick-trigger"
          ref={triggerRef}
          data-presentation={variant}
          aria-label={label}
        >
          {variant === "new" && canManage
            ? <Plus size={17} aria-hidden="true" />
            : <LayoutGrid size={16} aria-hidden="true" />}
          {variant === "new" ? <span>{label}</span> : (
            <>
              <span className="portal-quick-full-label">Quick actions</span>
              <span className="portal-quick-short-label">Actions</span>
              <ChevronDown size={14} aria-hidden="true" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="portal-quick-menu"
        aria-label={label}
      >
        {canManage && (
          <>
            <DropdownMenuGroup aria-label="Create">
              <DropdownMenuLabel className="portal-quick-group-label">
                Create
              </DropdownMenuLabel>
              {vehicle && (
                <div className="portal-quick-car-context">
                  <strong>{vehicle.title}</strong>
                  {vehicle.registration && <span>{vehicle.registration}</span>}
                </div>
              )}
              <DropdownMenuItem
                data-action="enquiry"
                onSelect={() => onEnquiry(vehicle?.id)}
              >
                <CustomerEnquiry size={18} />
                <span>New enquiry</span>
              </DropdownMenuItem>
              {bookingEnabled && (!vehicle || vehicle.canBook) && (
                <DropdownMenuItem
                  data-action="booking"
                  onSelect={() => onEnquiry(vehicle?.id, true)}
                >
                  <CalendarPlus size={18} />
                  <span>Book test drive</span>
                </DropdownMenuItem>
              )}
              {(!vehicle || vehicle.canStartSale) && (
                <DropdownMenuItem
                  data-action="sale"
                  onSelect={() => onSale(vehicle?.id)}
                >
                  <Sale size={18} />
                  <span>Start sale</span>
                </DropdownMenuItem>
              )}
              {onWriteLetter && (
                <DropdownMenuItem data-action="letter" onSelect={() => requestAnimationFrame(onWriteLetter)}>
                  <FilePenLine size={18} aria-hidden />
                  <span>Write a letter</span>
                </DropdownMenuItem>
              )}
              {onWriteEmail && (
                <DropdownMenuItem
                  data-action="email"
                  onSelect={() => requestAnimationFrame(onWriteEmail)}
                >
                  <Mail size={18} aria-hidden />
                  <span>Write an email</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="portal-quick-separator" />
          </>
        )}
        <DropdownMenuGroup aria-label="Tools">
          <DropdownMenuLabel className="portal-quick-group-label">
            Tools
          </DropdownMenuLabel>
          {canManage && (
            <DropdownMenuItem data-action="mot" onSelect={onMot}>
              <CheckCircle2 size={18} />
              <span>Check MOT</span>
            </DropdownMenuItem>
          )}
          {canManage && onPracticeSale && (
            <DropdownMenuItem data-action="practice-sale" onSelect={onPracticeSale}>
              <Sale size={18} aria-hidden="true" />
              <span>Try with a real car</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem data-action="calendar" onSelect={onCalendar}>
            <CalendarDays size={18} />
            <span>Calendar</span>
          </DropdownMenuItem>
          {canManage && (
            <DropdownMenuItem
              data-action="drafts"
              textValue="Email drafts"
              onSelect={onDrafts}
            >
              <Mail size={18} />
              <span>Email drafts</span>
              {!!draftCount && (
                <span
                  className="portal-quick-count"
                  aria-label={`${draftCount}${drafts.data?.hasMore ? " or more" : ""} saved replies`}
                >
                  {draftCount}
                  {drafts.data?.hasMore ? "+" : ""}
                </span>
              )}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
