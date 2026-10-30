import { Search } from "@/components/icons";
import type { ReactNode } from 'react';

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-border pb-6">
      <div className="min-w-0 flex-1 basis-64">
        {eyebrow && <p className="luxxy-kicker mb-3">{eyebrow}</p>}
        <h1 className="heading-1 break-words text-foreground">{title}</h1>
        {description && (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

export function PageEmptyState({ title, children, action }: {
  title: string; children: ReactNode; action: ReactNode;
}) {
  return <section className="page-empty-state mx-auto w-full min-w-0 max-w-lg py-10 text-center sm:py-14">
    <Search className="mx-auto mb-4 h-6 w-6 text-muted-foreground" aria-hidden="true" />
    <h2 className="break-words font-display text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>
    <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>
  </section>;
}
