import * as React from 'react';
import { cn } from '@/lib/utils';

// Matches the shared input's showroom treatment: squared, shadow-free, bold value
// against a lighter placeholder, and the same brass focus edge and halo.
export const textareaClass =
  'flex min-h-[60px] w-full rounded-none border-2 border-primary bg-background px-4 py-2 font-bold text-foreground shadow-[2px_2px_0px_hsl(var(--primary))] placeholder:font-bold placeholder:text-muted-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[4px_4px_0px_hsl(var(--accent))] disabled:cursor-not-allowed disabled:opacity-50 transition-all';

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
