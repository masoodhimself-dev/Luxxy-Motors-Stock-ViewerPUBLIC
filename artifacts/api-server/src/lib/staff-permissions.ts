export const staffRoles = ['owner', 'salesperson', 'accounts'] as const;
export type StaffRole = typeof staffRoles[number];
export const staffPermissions = ['integrations.manage', 'settings.publish', 'payments.refund', 'team.manage', 'finance.export', 'stock.manage', 'sales.manage', 'sales.handover', 'payments.record'] as const;
export type StaffPermission = typeof staffPermissions[number];
const grants: Record<StaffRole, readonly StaffPermission[]> = {
  owner: staffPermissions,
  salesperson: ['sales.manage', 'sales.handover', 'payments.record'],
  accounts: ['finance.export', 'payments.record', 'payments.refund'],
};
export function isStaffRole(value: unknown): value is StaffRole { return staffRoles.includes(value as StaffRole); }
export function permissionsForRole(role: StaffRole): readonly StaffPermission[] { return [...grants[role]]; }
export function roleHasPermission(role: StaffRole | undefined, permission: StaffPermission): boolean { return Boolean(role && grants[role]?.includes(permission)); }
/** Shared routing rule for existing staff actions and the local review service. */
export function operationPermission(method: string, path: string): StaffPermission | null {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (/^\/(dealer-integrations|email-templates)(\/|$)/.test(path)) return 'integrations.manage';
  if (/^\/staff\/team(\/|$)/.test(path)) return 'team.manage';
  if (path === '/dealer-operations/payments.csv') return 'finance.export';
  if (path.startsWith('/staff/settings-history') || (path === '/dealer-settings' && write)) return 'settings.publish';
  if (path === '/staff/chat/settings' && write) return 'settings.publish';
  if (!write) return null;
  if (/^\/staff\/chat(?:\/|$)/.test(path)) return 'sales.manage';
  if (/^\/staff\/vehicles\//.test(path)) return 'stock.manage';
  if (/^\/sale-workspace(?:\/|$)/.test(path)) {
    if (/\/payments\/[^/]+\/reverse$/.test(path)) return 'payments.refund';
    if (/\/payments(?:\/|$)/.test(path)) return 'payments.record';
    if (/\/documents(?:\/|$)/.test(path)) return 'payments.record';
    if (/\/handover$/.test(path)) return 'sales.handover';
    return 'sales.manage';
  }
  if (/^\/(staff\/enquiries|enquiries\/[^/]+|leads|test-drive-bookings\/[^/]+\/decision|reservations\/[^/]+\/cancel|customer-intake-sessions)(\/|$)/.test(path)) return 'sales.manage';
  return null;
}
