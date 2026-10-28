import { AccountInvitations } from "@/components/account-invitations";
import {
  Store,
  Globe2,
  CalendarDays,
  FileText,
  Mail,
  Users,
  ShieldCheck,
} from "@/components/icons";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SettingsTabs } from "@/components/settings-tabs";
import { DealerSettingsPanel } from "@/components/dealer-settings-panel";
import { SalesPaperworkSettings } from "@/components/sales-paperwork-settings";
import { EmailTemplatesSettings } from "@/components/email-templates-settings";
import { confirmSettingsNavigation } from "@/lib/settings-navigation";
import "./dealer-administration.css";
type Role = "owner" | "salesperson" | "accounts";
type Access = {
  role: Role;
  permissions: string[];
  user: { authUserId?: string; name?: string; email?: string };
};
export function useStaffAccess(enabled = true) {
  return useQuery({
    queryKey: ["staff-access"],
    queryFn: () => customFetch<Access>("/api/staff/access"),
    enabled,
    retry: false,
    staleTime: 60000,
  });
}
const request = <T,>(url: string, method = "GET", body?: unknown) =>
  customFetch<T>(url, {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "This action could not be completed.";
function Feedback({ error }: { error: unknown }) {
  return error ? (
    <p className="admin-error" role="alert">
      {message(error)}
    </p>
  ) : null;
}

type Member = {
  id: string;
  email: string | null;
  name: string | null;
  role: Role;
  active: boolean;
};
function TeamSettings() {
  const query = useQuery({
    queryKey: ["staff-team"],
    queryFn: () => request<{ members: Member[] }>("/api/staff/team"),
  });
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pendingRoles =
    query.data?.members.some(
      (member) => roles[member.id] && roles[member.id] !== member.role,
    ) ?? false;
  async function save(url: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(url, method, body);
      if (
        url.startsWith("/api/staff/team/") &&
        body &&
        typeof body === "object" &&
        "role" in body
      )
        setRoles((current) => {
          const next = { ...current };
          delete next[url.split("/").at(-1)!];
          return next;
        });
      await query.refetch();
      setNotice("Team access updated.");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dealer-admin" data-settings-dirty={pendingRoles}>
      <header className="admin-heading">
        <div>
          <h2>Your team</h2>
          <p>
            Give each member of staff their own account and the access they
            need.
          </p>
        </div>
      </header>
      <Feedback error={query.error} />
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="integration-notice">
          {notice}
        </p>
      )}
      <details className="admin-role-help">
        <summary>What each role can do</summary>
        <ul>
          <li>
            <strong>Owner:</strong> dealership settings, team access, customers
            and sales.
          </li>
          <li>
            <strong>Salesperson:</strong> customer enquiries,
            appointments and sales.
          </li>
          <li>
            <strong>Accounts:</strong> view existing sales, issue invoices, and record or refund payments.
          </li>
        </ul>
      </details>
      <AccountInvitations />
      <p className="admin-muted">
        Staff sign in with their own account. The last active owner cannot be
        removed.
      </p>
      <div className="admin-team-list">
        {query.isLoading && (
          <p role="status" className="admin-muted">
            Loading team access…
          </p>
        )}
        {query.data?.members.length === 0 && (
          <p className="admin-card admin-muted">
            No staff access records to show.
          </p>
        )}
        {query.data?.members.map((member) => {
          const nextRole = roles[member.id] ?? member.role,
            changed = nextRole !== member.role;
          return (
            <article className="admin-card admin-team-member" key={member.id}>
              <div>
                <h3>{member.name ?? member.email ?? "Staff member"}</h3>
                {member.name && <p>{member.email}</p>}
                <p className="admin-muted">
                  {member.active ? "Access enabled" : "Access disabled"}
                </p>
              </div>
              <div className="admin-team-role">
                <label>
                  Role
                  <NativeSelect
                    aria-label={`Role for ${member.email ?? member.id}`}
                    disabled={busy}
                    value={nextRole}
                    onChange={(event) =>
                      setRoles((current) => ({
                        ...current,
                        [member.id]: event.target.value as Role,
                      }))
                    }
                  >
                    <option value="owner">Owner</option>
                    <option value="salesperson">Salesperson</option>
                    <option value="accounts">Accounts</option>
                  </NativeSelect>
                </label>
                <Button
                  disabled={busy || !changed}
                  onClick={() =>
                    void save(`/api/staff/team/${member.id}`, "PATCH", {
                      role: nextRole,
                    })
                  }
                >
                  Apply role
                </Button>
              </div>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => {
                  if (
                    window.confirm(
                      `${member.active ? "Disable" : "Enable"} access for ${member.email ?? member.name}?`,
                    )
                  )
                    void save(`/api/staff/team/${member.id}`, "PATCH", {
                      active: !member.active,
                    });
                }}
              >
                {member.active ? "Disable access" : "Enable access"}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
export function DealerSettingsHub() {
  const [verticalNavigation, setVerticalNavigation] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 1200px)");
    const update = () => setVerticalNavigation(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const access = useStaffAccess(),
    search = useSearch(),
    [, navigate] = useLocation();
  const canTeam = access.data?.permissions.includes("team.manage") ?? false;
  const tabs = [
    { id: "dealership", label: "Business", icon: Store },
    { id: "website", label: "Brand", icon: Globe2 },
    { id: "bookings", label: "Bookings", icon: CalendarDays },
    { id: "paperwork", label: "Invoices & terms", icon: FileText },
    { id: "emails", label: "Messages", icon: Mail },
    ...(canTeam ? [{ id: "team", label: "Team", icon: Users }] : []),
  ];
  const requested =
      new URLSearchParams(search).get("settingsTab") ?? "dealership",
    selected = tabs.some((tab) => tab.id === requested)
      ? requested
      : "dealership";
  if (access.isLoading) return <p role="status">Loading settings access…</p>;
  if (access.isError) return <Feedback error={access.error} />;
  if (!access.data?.permissions.includes("settings.publish"))
    return <p role="status">Only an owner can change dealership settings.</p>;
  return (
    <section
      className="dealer-settings-hub settings-tabs-workspace"
      aria-label="Dealership settings"
    >
      <header className="settings-tabs-heading">
        <div>
          <h2>Settings</h2>
          <p>Your business, customer experience and team access.</p>
        </div>
        <span>
          <ShieldCheck size={15} />
          Owner access
        </span>
      </header>
      <SettingsTabs
        orientation={verticalNavigation ? "vertical" : "horizontal"}
        idPrefix="dealer-settings"
        label="Settings categories"
        value={selected}
        items={tabs}
        onValueChange={(id) => {
          if (id !== selected && confirmSettingsNavigation())
            navigate(`/portal?section=settings&settingsTab=${id}`);
        }}
      />
      <div
        className="settings-hub-content"
        role="tabpanel"
        id={`dealer-settings-panel-${selected}`}
        aria-labelledby={`dealer-settings-tab-${selected}`}
      >
        {["dealership", "website", "bookings"].includes(selected) && (
          <DealerSettingsPanel
            key={selected}
            group={selected as "dealership" | "website" | "bookings"}
          />
        )}
        {selected === "paperwork" && <SalesPaperworkSettings />}
        {selected === "emails" && <EmailTemplatesSettings />}
        {selected === "team" && <TeamSettings />}
      </div>
    </section>
  );
}
