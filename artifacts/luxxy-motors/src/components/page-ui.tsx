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
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-border pb-6">
      <div>
        {eyebrow && <p className="luxxy-kicker mb-3">{eyebrow}</p>}
        <h1 className="heading-1 text-primary">{title}</h1>
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
  return <section className="mx-auto max-w-lg py-10 text-center sm:py-14">
    <h2 className="font-display text-2xl font-semibold tracking-tight text-primary">{title}</h2>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>
    <div className="mt-6">{action}</div>
  </section>;
}
