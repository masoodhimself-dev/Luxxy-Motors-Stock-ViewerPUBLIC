---
name: Previewing token-gated buyer screens
description: How to get a real render of the buyer's secure-link screens (customer details, signing) in development, and why the signing one is expensive.
---

The buyer-facing paperwork screens are reachable only through a one-time token, so a screenshot needs a live session.

- A customer-details link can be minted with a single unauthenticated API call against a vehicle id; the whole flow (open → submit → thank-you state) can then be exercised and the rows deleted afterwards, leaving the development database as found.
- A signing link cannot be minted cheaply: preparing a sale is gated on its readiness checklist being complete, and some checklist items are themselves gated on recorded payments. Getting one render therefore means seeding a whole sale, which mutates shared development data.

**Why:** an attempt to screenshot the signing screen burned several round trips before hitting the checklist gate; the fallback is to verify its markup statically against a sibling screen that shares the same class vocabulary, plus a render of its error state (any invalid token shows it, with no data written).

**How to apply:** when a visual change touches these screens, budget for the intake flow only. If a full signing render is genuinely required, create a brand-new sale on a vehicle with no active sale so every row can be deleted afterwards — never drive an existing draft sale through the checklist.
