import { SignIn, SignUp } from '@clerk/react';
import { ShieldCheck } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function AccessFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="luxxy-shell relative flex min-h-[calc(100dvh-var(--site-header-height))] flex-col items-center justify-center gap-12 bg-background px-4 py-16">
      <div className="max-w-lg rounded-2xl border border-primary/10 bg-card p-8 text-center shadow-[0_18px_42px_hsl(var(--primary)/.1)] sm:p-10">
        <p className="mb-4 flex items-center justify-center gap-2 font-display text-[12px] font-semibold tracking-[.08em] text-accent">
          <ShieldCheck className="h-4 w-4" /> Staff entrance
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-[-.05em] text-primary">
          Luxxy Motors portal
        </h1>
        <p className="mt-4 border-l-2 border-accent pl-4 text-left text-[13px] font-medium leading-relaxed text-primary/70">
          The sales desk — enquiries, viewings, deals and paperwork. Customers
          never see this door.
        </p>
      </div>
      <div className="rounded-2xl border border-primary/10 bg-card shadow-[0_18px_42px_hsl(var(--primary)/.1)]">
        {children}
      </div>
    </div>
  );
}

export function StaffSignIn() {
  return (
    <AccessFrame>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        forceRedirectUrl={`${basePath}/portal`}
      />
    </AccessFrame>
  );
}

export function StaffSignUp() {
  return (
    <AccessFrame>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        forceRedirectUrl={`${basePath}/portal`}
      />
    </AccessFrame>
  );
}
