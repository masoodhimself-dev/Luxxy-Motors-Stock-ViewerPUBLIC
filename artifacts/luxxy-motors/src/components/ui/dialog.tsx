import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import './popup-surfaces.css';
import { X } from '@/components/icons';
import { watchPopupViewport } from './popup-viewport';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    data-popup-overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { overlayClassName?: string; closeDisabled?: boolean }
>(({ className, children, overlayClassName, closeDisabled = false, onEscapeKeyDown, onInteractOutside, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const opener = React.useRef<HTMLElement | null>(null);
  const stopWatchingViewport = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => stopWatchingViewport.current?.(), []);
  return (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      data-popup-surface="dialog"
      data-close-disabled={closeDisabled || undefined}
      onEscapeKeyDown={event => {
        onEscapeKeyDown?.(event);
        if (closeDisabled) event.preventDefault();
      }}
      onInteractOutside={event => {
        onInteractOutside?.(event);
        if (closeDisabled) event.preventDefault();
      }}
      onOpenAutoFocus={event => {
        const container = event.currentTarget as HTMLElement | null;
        stopWatchingViewport.current?.();
        stopWatchingViewport.current = container ? watchPopupViewport(container) : null;
        const active = document.activeElement;
        opener.current = active instanceof HTMLElement && active !== document.body && active !== document.documentElement && !container?.contains(active) ? active : null;
        if (onOpenAutoFocus) {
          onOpenAutoFocus(event);
          return;
        }
        // Keep the phone keyboard closed until the customer chooses a field.
        if (window.matchMedia?.('(max-width: 639px)').matches) {
          const title = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-popup-title]');
          if (title) {
            event.preventDefault();
            title.focus({ preventScroll: true });
          }
        }
      }}
      onCloseAutoFocus={event => {
        stopWatchingViewport.current?.();
        stopWatchingViewport.current = null;
        onCloseAutoFocus?.(event);
        // Controlled dialogs do not always have a Radix DialogTrigger. Keep the
        // same focus return for their ordinary buttons and nested popup openers.
        if (!event.defaultPrevented && opener.current?.isConnected) {
          event.preventDefault();
          opener.current.focus({ preventScroll: true });
        }
      }}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-md border border-border bg-card p-5 sm:p-8 shadow-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close data-popup-close disabled={closeDisabled} className="absolute right-3 top-3 rounded-md border border-transparent bg-transparent grid h-11 w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring shadow-none disabled:cursor-wait disabled:opacity-40">
        <X className="h-5 w-5" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-popup-header
    className={cn(
      'flex flex-col space-y-2 text-left border-b border-border pb-4',
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-popup-footer
    className={cn(
      'flex flex-row flex-wrap items-center justify-end gap-2 mt-0 pt-4 border-t border-border',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-popup-title
    tabIndex={-1}
    className={cn(
      'pr-12 font-display text-xl sm:text-2xl font-semibold leading-tight tracking-tight text-primary [overflow-wrap:anywhere]',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm font-normal tracking-normal text-muted-foreground leading-relaxed', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
