import { SignInButton, UserButton, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { ReactNode } from "react";
import { ArrowRight, Building2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { sharedStaffWorkspacePath } from "@/lib/shared-staff-portal";
import "./shared-staff-portal.css";

export type StaffDealership = {
  dealerId: string;
  dealerName: string;
  role: "owner" | "salesperson" | "accounts";
};

const roleName = { owner: "Owner", salesperson: "Salesperson", accounts: "Accounts" };

function StaffEntry({ account, children }: { account?: ReactNode; children: ReactNode }) {
  return (
    <main className="shared-staff-entry">
      <header className="shared-staff-header">
        <a href="/portal" aria-label="DealerOS staff portal">Dealer<span>OS</span></a>
        {account}
      </header>
      <section className="shared-staff-content">{children}</section>
    </main>
  );
}

export function StaffDealershipPicker({ dealerships, account }: { dealerships: StaffDealership[]; account?: ReactNode }) {
  return (
    <StaffEntry account={account}>
      <h1>Your dealerships</h1>
      {dealerships.length ? (
        <ul className="shared-staff-dealers" aria-label="Dealerships">
          {dealerships.map((dealer) => (
            <li key={dealer.dealerId}>
              <a href={sharedStaffWorkspacePath(dealer.dealerId)}>
                <Building2 aria-hidden="true" size={23} />
                <span><strong>{dealer.dealerName}</strong><small>{roleName[dealer.role]}</small></span>
                <ArrowRight aria-hidden="true" size={18} />
              </a>
            </li>
          ))}
        </ul>
      ) : <p>Ask your dealership owner to send an invitation to your staff email address.</p>}
    </StaffEntry>
  );
}

export function SharedStaffPortal({ dealerId, children }: { dealerId: string | null; children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const memberships = useQuery({
    queryKey: ["shared-staff-memberships", userId],
    enabled: isLoaded && Boolean(userId),
    retry: false,
    queryFn: ({ signal }) => customFetch<{ dealerships: StaffDealership[] }>(
      `${window.location.origin}/api/staff-portal/memberships`, { signal },
    ),
  });
  if (!isLoaded || (userId && memberships.isPending)) return (
    <StaffEntry><p role="status">Checking staff access…</p></StaffEntry>
  );
  if (!userId) {
    const next = window.location.pathname + window.location.search;
    return (
      <StaffEntry>
        <h1>Sign in to DealerOS</h1>
        <p>Use your staff account to open your dealership workspace.</p>
        <SignInButton mode="redirect" forceRedirectUrl={next} signUpForceRedirectUrl={next}>
          <Button className="mt-5 min-h-11">Sign in</Button>
        </SignInButton>
      </StaffEntry>
    );
  }
  const account = <UserButton />;
  if (memberships.isError) return (
    <StaffEntry account={account}>
      <h1>Your dealerships</h1>
      <p role="alert">Your dealerships could not be loaded.</p>
      <Button className="mt-5 min-h-11" onClick={() => void memberships.refetch()}>Try again</Button>
    </StaffEntry>
  );
  const allowed = memberships.data?.dealerships ?? [];
  if (dealerId && allowed.some((dealer) => dealer.dealerId === dealerId)) return <>{children}</>;
  return <StaffDealershipPicker dealerships={allowed} account={account} />;
}
