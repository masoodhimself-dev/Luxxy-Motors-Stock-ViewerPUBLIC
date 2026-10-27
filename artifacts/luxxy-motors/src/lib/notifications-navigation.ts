export const notificationViews = ['customers', 'test-drives', 'email'] as const;
export type NotificationView = typeof notificationViews[number];
const legacyViews: Record<string, NotificationView> = { overview: 'customers', enquiries: 'customers', 'test-drives': 'test-drives', email: 'email' };

/** Old emailed/bookmarked portal links remain valid inside the combined workspace. */
export function notificationView(search: string): NotificationView {
  const params = new URLSearchParams(search);
  const legacy = legacyViews[params.get('section') || ''];
  if (legacy) return legacy;
  const requested = params.get('workView');
  if (notificationViews.includes(requested as NotificationView)) return requested as NotificationView;
  if (params.has('compose') || params.has('draft')) return 'email';
  if (params.get('deskView') === 'calendar') return 'test-drives';
  if (params.has('enquiryId')) return 'customers';
  return 'customers';
}

export function notificationHref(view: NotificationView, search = ''): string {
  const previous = new URLSearchParams(search), params = new URLSearchParams({ section: 'notifications', workView: view });
  {
    const enquiry = previous.get('enquiryId') || previous.get('compose') || previous.get('draft');
    if (enquiry) params.set('enquiryId', enquiry);
    if (notificationView(search) === view) {
      const keys = view === 'email' ? ['customer', 'view', 'compose', 'draft', 'soldSaleId'] : ['deskView'];
      for (const key of keys) { const value = previous.get(key); if (value) params.set(key, value); }
    }
  }
  return `/portal?${params}`;
}

/** Canonicalise internal links without touching external URLs or unrelated sections. */
export function notificationsLink(href: string): string {
  if (!href.startsWith('/portal?')) return href;
  const params = new URLSearchParams(href.slice('/portal?'.length)), view = legacyViews[params.get('section') || ''];
  if (!view) return href;
  params.set('section', 'notifications'); params.set('workView', view);
  return `/portal?${params}`;
}

export function isNotificationsSection(section: string | null) {
  return !section || section === 'notifications' || Object.hasOwn(legacyViews, section);
}
