-- Append-only staff conversation history uses existing event detail storage.
ALTER TYPE public.enquiry_event_kind ADD VALUE IF NOT EXISTS 'conversation_logged';
