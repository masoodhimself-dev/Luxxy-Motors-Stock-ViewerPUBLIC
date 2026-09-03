---
name: Lead pipeline and enquiry carry-across
description: How enquiries relate to leads, the rule for carrying old enquiries across, and the invariants that make the lead timeline trustworthy.
---

An enquiry is the *opening event* of a lead, not a competing record. The enquiry table keeps its original shape and the public form is untouched; a lead is opened alongside it in the same transaction, and each enquiry may open at most one lead.

**Carry-across rule** (identical for a live website enquiry and for enquiries that predate leads):
- closed enquiry → `lost`, with an explicit reason stating the original outcome was never recorded, and `closedAt` taken from the enquiry's own `updatedAt`
- viewing with an appointment → `viewing_booked`
- contacted → `qualifying`
- otherwise → `new`

**Why:** the old inbox had three flags and no history, so any richer stage would be invented data. `lastContactedAt` is deliberately left null on carried-across leads for the same reason — the moment of contact was never recorded, and a timeline entry says so in plain words rather than guessing a time.

**Invariants worth preserving:**
- A lead is only ever closed by recording an outcome *and* a reason; the stage endpoint accepts open stages only. A database check constraint enforces the same pairing, so a bad write fails loudly rather than producing a closed lead with no reason.
- The timeline is append-only by construction: nothing updates or deletes an event, and stage changes append rather than overwrite. `occurredAt` (when it happened in the real world) is separate from `createdAt` (when it was recorded), so back-dated and carried-across touches keep their real time.
- A deposit at the `reserved` stage is offline only (cash, card machine, bank transfer, other) and must state amount, method and time together. Leave room for online payment later; do not add a provider here.
- Sale creation advances its lead and stores `leadId` on the sale (not a `saleId` on the lead) — the FK direction avoids an import cycle between the sales and leads schema modules.

**How to apply:** the carry-across runs at API-server startup, batched and advisory-locked, because `drizzle-kit push` applies schema but never data. It is idempotent, so restarts are safe.
