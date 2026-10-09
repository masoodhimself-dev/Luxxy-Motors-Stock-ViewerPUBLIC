/** Platform privileges are explicit Clerk user IDs, never the dealership owner role. */
export function isPlatformAdmin(authUserId: string | undefined, configured = process.env.PLATFORM_ADMIN_USER_IDS ?? ''): boolean {
  return Boolean(authUserId && authUserId !== 'machine' && configured.split(',').map(id => id.trim()).filter(Boolean).includes(authUserId));
}
