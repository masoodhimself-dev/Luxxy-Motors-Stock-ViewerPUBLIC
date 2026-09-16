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
        'inline-flex items-center rounded-md border px-3 py-1 font-display text-[10px] font-semibold  tracking-normal transition-colors focus:outline-none shadow-none',
        {
          'border-primary bg-primary text-primary-foreground': variant === 'default',
          'border-primary bg-secondary text-primary': variant === 'secondary',
          'border-destructive bg-destructive text-destructive-foreground shadow-none': variant === 'destructive',
          'border-amber-500 bg-amber-500 text-black shadow-none': variant === 'warning',
          'border-primary bg-background text-primary': variant === 'outline',
        },
        className
      )}
      {...props}
    />
  );
}