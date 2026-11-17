// Aliased only by vite.preview.config.ts. Never imported by the production entry.
import type { ReactNode } from 'react';
function signedOutStaffPreview() {
  return typeof window !== 'undefined' && window.location.pathname === '/__preview/staff-login' &&
    new URLSearchParams(window.location.search).get('state') === 'signed-out';
}
export const useAuth = () => ({
  isLoaded: true,
  isSignedIn: !signedOutStaffPreview(),
  userId: signedOutStaffPreview() ? null : 'user_exampleStaff',
});
export const useUser = () => ({
  user: { firstName: 'Alex', primaryEmailAddress: { emailAddress: 'alex@example.com' } },
});
export const UserButton = () => (
  <span
    className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-sm font-semibold"
    aria-label="Staff account"
  >
    AL
  </span>
);
export const SignInButton = ({ children }: { children: ReactNode }) => signedOutStaffPreview()
  ? <span onClick={() => window.location.assign('/__preview/staff-login')}>{children}</span>
  : <>{children}</>;

export const useClerk = () => ({signOut:async()=>{},addListener:()=>()=>{}});
