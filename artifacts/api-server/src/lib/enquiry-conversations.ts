import { callOutcomes, outcomeError, type CallOutcome } from './enquiry-workspace';

type ConversationEntry = {
  workspaceRevision?: number;
  followUpRevision?: number;
  followUpAt?: Date | string | null;
  followUpCompletedAt?: Date | string | null;
  appointmentAt?: Date | string | null;
  appointmentCancelledAt?: Date | string | null;
  status: string;
};
export type ConversationInput = {
  expectedRevision: number;
  expectedFollowUpRevision: number;
  note: string;
  callOutcome: CallOutcome;
  followUpAt?: Date;
  followUpNote?: string;
};
export class ConversationError extends Error {
  constructor(message: string, public status: 400 | 409) { super(message); }
}

/** Validate the whole change before either the record or its immutable event is saved. */
export function conversationChange(entry: ConversationEntry, input: ConversationInput, staff: { id: string; name: string }, now = new Date()) {
  if ((entry.workspaceRevision ?? 0) !== input.expectedRevision || (entry.followUpRevision ?? 0) !== input.expectedFollowUpRevision) throw new ConversationError('This enquiry or follow-up changed. Refresh and review it before saving.', 409);
  const note = input.note.trim();
  if (!note) throw new ConversationError('Add a note about the conversation.', 400);
  if (input.followUpNote !== undefined && !input.followUpAt) throw new ConversationError('Choose a time for the next follow-up note.', 400);
  if (input.followUpAt && (!Number.isFinite(input.followUpAt.getTime()) || input.followUpAt.getTime() <= now.getTime())) throw new ConversationError('Choose a future follow-up time.', 400);
  const next = input.followUpAt ? { ...entry, followUpAt: input.followUpAt, followUpCompletedAt: null } : entry;
  const problem = outcomeError(next, input.callOutcome);
  if (problem) throw new ConversationError(problem, 409);
  return {
    update: {
      callOutcome: input.callOutcome,
      status: entry.status === 'new' ? 'contacted' as const : entry.status as 'contacted' | 'closed',
      workspaceRevision: (entry.workspaceRevision ?? 0) + 1,
      ...(input.followUpAt ? { followUpAt: input.followUpAt, followUpNote: input.followUpNote?.trim() || null, followUpCompletedAt: null, followUpRevision: (entry.followUpRevision ?? 0) + 1 } : {}),
      updatedAt: now,
    },
    summary: `Conversation logged by ${staff.name}: ${callOutcomes[input.callOutcome]}`,
    detail: { note, staffId: staff.id, staffName: staff.name, callOutcome: input.callOutcome, followUpAt: next.followUpAt ? new Date(next.followUpAt).toISOString() : null },
    occurredAt: now,
  };
}
