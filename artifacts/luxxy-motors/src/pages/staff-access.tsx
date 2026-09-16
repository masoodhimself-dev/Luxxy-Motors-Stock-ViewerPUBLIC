import { SignIn, SignUp } from '@clerk/react';
import { ShieldCheck } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function AccessFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="luxxy-shell relative flex min-h-[calc(100dvh-var(--site-header-height))] flex-col items-center justify-center gap-12 bg-background px-4 py-16">
      <div className="max-w-lg rounded-lg border border-primary/10 bg-card p-8 text-center shadow-none sm:p-10">
        <p className="mb-4 flex items-center justify-center gap-2 font-display text-[12px] font-semibold tracking-normal text-accent">
          <ShieldCheck className="h-4 w-4" /> Staff entrance
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-[-.05em] text-primary">
          Luxxy Motors portal
        </h1>
        <p className="mt-4 border-l-2 border-accent pl-4 text-left text-[13px] font-medium leading-relaxed text-primary/70">
          The sales desk — enquiries, viewings, deals and paperwork. Use your authorised staff account to continue.
        </p>
      </div>
      <div className="rounded-lg border border-primary/10 bg-card shadow-none">
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
