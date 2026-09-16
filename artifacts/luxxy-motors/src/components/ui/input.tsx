import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const inputClass =
  'luxxy-control rounded-md border border-input bg-card text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring flex w-full font-normal placeholder:font-normal placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors file:border-0 file:bg-transparent file:font-medium';

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
