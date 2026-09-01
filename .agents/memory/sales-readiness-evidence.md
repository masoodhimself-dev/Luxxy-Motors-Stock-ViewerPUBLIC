---
name: Sales readiness evidence
description: The durable rule for auditable sale checklist confirmations and invalidation.
---

Sales readiness confirmations must reference existing sale, customer, vehicle, fulfilment, payment, warranty, part-exchange and document records through a hashable evidence snapshot rather than duplicating deal data.

**Why:** A checkbox without the underlying commercial evidence can become stale or misleading when a deal changes.

**How to apply:** On checklist reads, compare the stored evidence hash with the current record-derived hash; treat a mismatch as invalidated and require reconfirmation before preparation or completion.