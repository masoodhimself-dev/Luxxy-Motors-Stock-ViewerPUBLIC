import { SignIn, SignUp } from '@clerk/react';
import { ShieldCheck } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function AccessFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="luxxy-grain relative flex min-h-[calc(100dvh-var(--site-header-height))] flex-col items-center justify-center gap-8 bg-background px-4 py-16">
      <div className="text-center">
        <p className="luxxy-kicker justify-center text-accent">
          <ShieldCheck className="h-3.5 w-3.5" /> Staff entrance
        </p>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-[-.02em] text-primary sm:text-4xl">
          Luxxy Motors Portal
        </h1>
        <p className="luxxy-leader mx-auto mt-3 max-w-md">
          The sales desk — enquiries, viewings, deals and paperwork. Customers
          never see this door.
        </p>
      </div>
      {children}
    </div>
  );
}

export function StaffSignIn() {
  return (
    <AccessFrame>
      {/* path must be the full browser path — Clerk reads window.location.pathname directly */}
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
