import * as React from 'react';
import { cn } from '@/lib/utils';

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

// The showroom field language for a native dropdown, matching the shared Input and
// Textarea: squared and shadow-free, a bold value, and a brass focus edge with a soft
// brass halo sitting flush to the border. Selects keep an explicit `rounded-none`
// because browsers round them by default, and they stay on `focus:` rather than
// `focus-visible:` so the brass edge also shows when the control is opened by mouse.
// Call sites should only add genuinely per-screen tweaks — a taller control, a fixed
// width, or the hero's translucent-on-ink palette.
export const nativeSelectClass =
  'h-11 w-full rounded-none border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-45';

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select className={cn(nativeSelectClass, className)} ref={ref} {...props}>
        {children}
      </select>
    );
  }
);
NativeSelect.displayName = 'NativeSelect';
