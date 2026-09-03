---
name: Lead model ownership
description: Cross-task ownership and migration boundary for the shared lead model.
---

The shared lead model is owned by the lead-groundwork workstream. Portal and other
dealer-facing features must consume its current schema and event vocabulary rather
than introducing a competing lead/activity model.

**Why:** Lead groundwork may be migrating in the same development database while
portal work is being built; replacing those tables or pushing a conflicting schema
can destroy continuity and block parallel work.

**How to apply:** Before changing lead persistence, inspect the current shared
schema and migration state. Restrict portal-owned database changes to additive
objects and keep API/UI adapters at the boundary when the shared model differs
from the portal's display contract.