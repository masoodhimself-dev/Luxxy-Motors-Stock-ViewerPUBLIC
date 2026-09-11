import * as React from 'react';
import { cn } from '@/lib/utils';

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'warning' }) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-none border-2 px-3 py-1 font-display text-[10px] font-black uppercase tracking-[0.2em] transition-colors focus:outline-none shadow-[2px_2px_0px_hsl(var(--primary))]',
        {
          'border-primary bg-primary text-primary-foreground': variant === 'default',
          'border-primary bg-secondary text-primary': variant === 'secondary',
          'border-destructive bg-destructive text-destructive-foreground shadow-[2px_2px_0px_hsl(var(--accent))]': variant === 'destructive',
          'border-amber-500 bg-amber-500 text-black shadow-[2px_2px_0px_#b45309]': variant === 'warning',
          'border-primary bg-background text-primary': variant === 'outline',
        },
        className
      )}
      {...props}
    />
  );
}