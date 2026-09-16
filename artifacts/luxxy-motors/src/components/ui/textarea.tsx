import * as React from 'react';
import { cn } from '@/lib/utils';

export const textareaClass =
  'luxxy-control rounded-md border border-input bg-card text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring flex w-full font-normal placeholder:font-normal placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors min-h-28 resize-y';

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
