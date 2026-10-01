import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

// Secondary actions are available on demand on phones and remain visible on larger screens.
export function MobileActionDisclosure({ label, children, className, contentClassName, testId }: {
  label: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  testId?: string;
}) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  return (
    <Collapsible open={!isMobile || expanded} onOpenChange={setExpanded} className={className} data-testid={testId}>
      <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-medium text-muted-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden">
        {label}<ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('pt-2 md:pt-0', contentClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
