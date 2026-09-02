import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

// Showroom field language: squared and shadow-free, a bold value against a lighter
// placeholder, and a brass focus edge with a soft brass halo sitting flush to the
// border. Call sites should only add genuinely per-screen tweaks — height, padding
// for an icon, or the hero's translucent-on-ink palette.
export const inputClass =
  'flex h-10 w-full rounded-none border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputClass, className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
