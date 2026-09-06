---
name: Approved Luxxy visual direction
description: The visual identity and showroom concept the user explicitly approved for Luxxy Motors.
---

Use the editorial automotive concierge direction: warm sage-paper surfaces, deep ink teal, restrained brass accents, confident editorial typography, and a shortlist-first buying experience. The approved logo direction is a compact L/X road-inspired monogram paired with the “LUXXY / MOTORS · HARROW” lockup.

**Why:** The user explicitly described this direction as a great design after reviewing the live canvas frame.

**How to apply:** Keep future Luxxy logo refinements, responsive variants, and any showroom redesign consistent with this identity unless the user asks for a different direction.

Shared UI primitives carry the identity themselves: squared corners and no drop shadow are the default, and a surface that genuinely wants a soft edge opts in with its own `rounded-*` / `shadow-*` class.

**Why:** Screens were each undoing the starter kit's rounded, shadowed defaults by hand, so a single missed override let the old look creep back in.

**How to apply:** When a Luxxy primitive still ships starter-kit rounding or shadow, fix the primitive rather than adding another per-call-site override. The squared, flat default is held in place by a shared rule in the showroom app's test helpers: as further primitives are squared, extend that rule to cover them instead of hand-writing a fresh radius/shadow assertion, and keep it reading the rendered class list so a regression hidden behind a `hover:`/breakpoint prefix or a cva variant still fails.

The approved homepage opening is an editorial forecourt split: concise serif copy beside a real featured vehicle, two actions for browsing and guided matching, then a compact trust strip.

**Why:** The earlier text-only opening felt too tall and abstract before shoppers reached the stock.

**How to apply:** Keep the opening visually tied to live inventory, preserve the short path into browsing, and avoid expanding trust points back into a tall pre-stock section.

The rotating featured-forecourt treatment is explicitly approved. Keep its imagery prominent while showing a restrained line of useful buying facts rather than turning it into another full vehicle card.