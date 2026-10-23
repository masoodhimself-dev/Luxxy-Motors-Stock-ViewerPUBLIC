import { useQuery } from '@tanstack/react-query';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
export type ReplyAttention = { enquiryId: string; pending: number; review: number; responded?: boolean; latestReplyText?: string | null };
export type InboxEnquiry = Enquiry & { pendingEmailReplies?: number; emailRepliesToReview?: number; staffEmailSent?: boolean; latestReplyText?: string | null };
export function applyReplyAttention(entries: readonly Enquiry[], attention: readonly ReplyAttention[]): InboxEnquiry[] {
  const byId = new Map(attention.map(row => [row.enquiryId, row]));
  return entries.map(entry => ({ ...entry, pendingEmailReplies: byId.get(entry.id)?.pending ?? 0, emailRepliesToReview: byId.get(entry.id)?.review ?? 0, staffEmailSent: byId.get(entry.id)?.responded ?? false, latestReplyText: byId.get(entry.id)?.latestReplyText }));
}
export function useReplyAttention(enabled: boolean) {
  return useQuery({ queryKey: ['reply-attention'], enabled,
    queryFn: () => customFetch<{ enquiries: ReplyAttention[] }>('/api/staff/email/reply-attention'),
    refetchInterval: 30000, retry: false });
}
