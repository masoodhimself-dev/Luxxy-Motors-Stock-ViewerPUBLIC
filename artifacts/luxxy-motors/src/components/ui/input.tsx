import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const inputClass =
  'flex h-12 w-full rounded-none border-2 border-primary bg-background px-4 py-2 font-bold text-foreground shadow-[2px_2px_0px_hsl(var(--primary))] file:border-0 file:bg-transparent file:font-display file:text-[11px] file:font-bold file:uppercase file:tracking-widest placeholder:font-bold placeholder:text-muted-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[4px_4px_0px_hsl(var(--accent))] disabled:cursor-not-allowed disabled:opacity-50 transition-all';

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
