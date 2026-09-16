// Aliased only by vite.preview.config.ts. Never imported by the production entry.
import type { ReactNode } from 'react';
export const useAuth = () => ({ isLoaded: true, isSignedIn: true });
export const useUser = () => ({
  user: { firstName: 'Alex', primaryEmailAddress: { emailAddress: 'alex@example.com' } },
});
export const UserButton = () => (
  <span
    className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-sm font-semibold"
    aria-label="Sample staff account"
  >
    AL
  </span>
);
export const SignInButton = ({ children }: { children: ReactNode }) => <>{children}</>;
