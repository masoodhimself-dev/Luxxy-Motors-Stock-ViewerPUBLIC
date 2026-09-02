---
name: Testing Radix overlay surfaces in vitest/jsdom
description: What has to be in place before a Radix popover, dropdown, select or dialog can be asserted on in the luxxy-motors vitest suite.
---

Radix popper surfaces (popover, dropdown-menu, select) will not mount under jsdom until `ResizeObserver`,
`Element.prototype.scrollIntoView` and the pointer-capture methods are stubbed. Render them controlled
(`open` / `defaultValue`) rather than driving them through user events.

An open Radix panel marks the rest of the tree `aria-hidden`, so the *trigger* disappears from the
accessibility tree: `getByRole('combobox')` fails while the select is open. Query the trigger by test id
and keep role queries for the portalled panel and its items (`dialog`, `menu`, `menuitem`, `listbox`,
`option`).

**Why:** These two quirks each look like a broken component rather than a missing test environment, and
they cost a debugging round trip every time a new shared-surface test is written.

**How to apply:** Reach for this whenever a test needs to assert on the rendered classes or content of a
Radix overlay in this workspace, including future look-and-feel guards over the shared UI kit.
