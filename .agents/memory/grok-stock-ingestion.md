---
name: Grok stock ingestion
description: The boundary and storage decision for stock snapshots sent by a Grok bot.
---

The Grok stock endpoint accepts the same complete normalized snapshot shape as the existing stock importer, but keeps the stored vehicle source aligned with the current public stock projection.

**Why:** The showroom currently has one configured dealership stock feed. Introducing a second persisted source would require changing public stock, vehicle lookup, enquiry validation, and configuration semantics together.

**How to apply:** Preserve the existing shared-secret, freshness, count, duplicate, image, stock-drop, price-review, audit, and idempotency safeguards. Treat the Grok route as an external adapter unless multi-source stock is deliberately designed later.