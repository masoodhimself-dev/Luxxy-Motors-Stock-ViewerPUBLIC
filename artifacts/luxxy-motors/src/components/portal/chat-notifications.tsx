import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import type { ChatInbox, ChatSettings } from '@workspace/vehicle-meta';
import { useRefreshActive } from '@/lib/refresh-policy';

/** Portal-only unread indicator; no browser permission prompt or unsolicited popup. */
export function ChatUnreadBadge() {
  const active = useRefreshActive();
  const settings = useQuery({ queryKey: ['staff-chat-settings'], queryFn: () => customFetch<ChatSettings>('/api/staff/chat/settings'), retry: false, staleTime: 30_000, refetchInterval: active ? 30_000 : false, enabled: active });
  const inbox = useQuery({ queryKey: ['staff-chat-inbox'], queryFn: () => customFetch<ChatInbox>('/api/staff/chat/conversations'), retry: false, refetchInterval: active ? 30_000 : false, enabled: active && settings.data?.notificationsEnabled === true });
  const count = inbox.data?.totalUnread ?? 0;
  if (!settings.data?.notificationsEnabled || count < 1) return null;
  return <span aria-label={`${count} unread chat messages`} className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-4 text-primary-foreground">{count > 99 ? '99+' : count}</span>;
}
