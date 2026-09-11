import { SignIn, SignUp } from '@clerk/react';
import { ShieldCheck } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function AccessFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="luxxy-shell relative flex min-h-[calc(100dvh-var(--site-header-height))] flex-col items-center justify-center gap-12 bg-background px-4 py-16">
      <div className="text-center border-4 border-primary p-10 bg-background shadow-[8px_8px_0px_hsl(var(--primary))] max-w-lg">
        <p className="font-display text-[12px] font-black uppercase tracking-[0.2em] text-accent flex justify-center items-center gap-2 mb-4">
          <ShieldCheck className="h-4 w-4" /> STAFF ENTRANCE
        </p>
        <h1 className="font-display text-4xl font-black uppercase tracking-tighter text-primary">
          LUXXY MOTORS PORTAL
        </h1>
        <p className="mt-4 text-[13px] font-bold uppercase tracking-widest leading-relaxed text-primary/70 border-l-4 border-accent pl-4 text-left">
          The sales desk — enquiries, viewings, deals and paperwork. Customers
          never see this door.
        </p>
      </div>
      <div className="border-4 border-primary shadow-[8px_8px_0px_hsl(var(--primary))] bg-background">
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
