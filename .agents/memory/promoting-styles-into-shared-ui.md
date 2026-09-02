---
name: Promoting repeated utility strings into a shared UI component
description: How to move a hand-repeated Tailwind string into a shared component's base class without silently changing call sites; the pseudo-element trap.
---

Before moving a repeated utility string into a shared UI component's base class, enumerate every call site and diff the *merged* class list (base + call-site className through `tailwind-merge`) before and after. Run the diff mechanically rather than by eye — a script that merges each real call-site string and prints added/removed tokens catches what reading cannot.

**Why:** `cn()` runs `twMerge`, so a call site reliably wins for any utility in the *same* conflict group (height, border colour, ring width...). That safety does not extend to pseudo-element variants. A base `placeholder:font-normal` is not in the same group as a call site's element-level `font-black` or `font-semibold`, so it survives the merge and quietly restyles that call site's placeholder — this is how a number-plate field lost its heavy placeholder while every other field looked fine. Screenshots of unfocused, filled fields hide it; the placeholder only shows when the field is empty.

**How to apply:** when the new base adds a `placeholder:*`, `file:*`, `::before`-style, or state-variant utility, check each call site that sets the plain (non-variant) version of the same property and restate the variant there if it should differ. Also treat a base default and a per-screen override as different things: keep genuinely per-screen values (heights, translucent-on-ink palettes, icon padding) at the call site, and only promote what every instance should share.
