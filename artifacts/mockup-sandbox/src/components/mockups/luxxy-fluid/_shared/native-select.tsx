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
  'h-12 w-full appearance-none rounded-none border-2 border-primary bg-background px-4 font-bold uppercase tracking-wider text-[12px] text-foreground shadow-[2px_2px_0px_hsl(var(--primary))] outline-none transition-all focus:border-accent focus:ring-0 focus:shadow-[4px_4px_0px_hsl(var(--accent))] disabled:cursor-not-allowed disabled:opacity-45';

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
