import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { vehicleFeatureHelp, vehicleHelpText } from '@/lib/vehicle-help';
import { cn } from '@/lib/utils';

/** Explain an existing action without changing what clicking it does. */
export function HoverHelp({ text, children }: { text: string; children: ReactElement }) {
  return <TooltipProvider delayDuration={350}><Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="customer-help-content" sideOffset={8} collisionPadding={12}>{text}</TooltipContent>
  </Tooltip></TooltipProvider>;
}

/** Hover or focus for help; tap to keep it open on touch devices. */
export function TermHelp({ text, children, className, ariaLabel }: { text: string; children: ReactNode; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = () => { clearTimer(); setOpen(true); };
  const hide = () => {
    clearTimer();
    if (!pinned.current && !trigger.current?.matches(':focus-visible')) {
      timer.current = setTimeout(() => setOpen(false), 160);
    }
  };

  return <Popover open={open} onOpenChange={next => {
    clearTimer();
    pinned.current = false;
    setOpen(next);
  }}>
    <PopoverAnchor asChild>
      <button
        ref={trigger}
        type="button"
        className={cn('customer-term-help', className)}
        aria-label={ariaLabel}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerEnter={event => {
          if (event.pointerType === 'touch') return;
          clearTimer();
          timer.current = setTimeout(show, 250);
        }}
        onPointerLeave={hide}
        onFocus={event => { if (event.currentTarget.matches(':focus-visible')) show(); }}
        onBlur={hide}
        onClick={event => {
          event.stopPropagation();
          clearTimer();
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >{children}</button>
    </PopoverAnchor>
    <PopoverContent
      id={id}
      role="tooltip"
      aria-hidden={!open}
      className="customer-help-content"
      side="top"
      sideOffset={8}
      collisionPadding={12}
      onOpenAutoFocus={event => event.preventDefault()}
      onCloseAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => {
        // The anchor is outside the portal. Let its own click toggle the help.
        if (trigger.current?.contains(event.target as Node)) event.preventDefault();
      }}
      onPointerEnter={clearTimer}
      onPointerLeave={hide}
    >{text}</PopoverContent>
  </Popover>;
}

export function VehicleTerm({ label, value, children, className, ariaLabel }: { label: string; value?: string; children: ReactNode; className?: string; ariaLabel?: string }) {
  const text = vehicleHelpText(label, value);
  return text ? <TermHelp text={text} className={className} ariaLabel={ariaLabel}>{children}</TermHelp> : <span className={className} aria-label={ariaLabel}>{children}</span>;
}

export function VehicleFeature({ feature }: { feature: string }) {
  const text = vehicleFeatureHelp(feature);
  return text ? <TermHelp text={text}>{feature}</TermHelp> : <span>{feature}</span>;
}
