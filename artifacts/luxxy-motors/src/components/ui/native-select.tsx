import * as React from 'react';
import { cn } from '@/lib/utils';

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const nativeSelectClass =
  'luxxy-control rounded-md border border-input bg-card text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring flex w-full font-normal placeholder:font-normal placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors';

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
