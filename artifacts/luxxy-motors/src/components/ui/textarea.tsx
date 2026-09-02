import * as React from 'react';
import { cn } from '@/lib/utils';

// Matches the shared input's showroom treatment: squared, shadow-free, bold value
// against a lighter placeholder, and the same brass focus edge and halo.
export const textareaClass =
  'flex min-h-[60px] w-full rounded-none border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(textareaClass, className)}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
