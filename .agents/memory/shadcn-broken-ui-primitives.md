---
name: shadcn chart & OTP primitives don't typecheck here
description: The stock shadcn chart.tsx and input-otp.tsx fail typecheck in this workspace; patch them on arrival or don't add them.
---

# shadcn chart & OTP primitives don't typecheck in this workspace

The stock shadcn `chart.tsx` and `input-otp.tsx` files do **not** pass `tsc` as generated
here. Treat them as needing a typing patch on arrival, never as drop-in files.

The two failure shapes:

- **chart.tsx** — recharts 2.x still exports `Tooltip` as a class component, which the
  installed React type defs reject as a `JSXElementConstructor`. Everything derived from
  `React.ComponentProps<typeof Tooltip>` then collapses, so `active`, `payload`, `label`,
  `formatter`, `labelFormatter`, and `labelClassName` all report as non-existent props and
  the `payload.filter/map` callbacks fall back to implicit `any`.
- **input-otp.tsx** — `OTPInputContext` resolves to `unknown`, so reading `.slots[index]`
  errors.

**Why:** both files shipped unused in the web app and were deleted rather than patched, so
its typecheck could pass. The deletion is why the evidence is no longer greppable there —
but the underlying version mismatch is unchanged, and the design canvas artifact still
carries broken copies of both.

**How to apply:** if a real need for a chart or a code-entry input appears, budget time to
fix the generated types (or pin/upgrade recharts deliberately) and re-run the owning
artifact's `typecheck` before assuming the component is usable. Do not re-add these files
untouched just because shadcn generated them. Adding a chart again also means `recharts`
and `input-otp` are still listed as dev dependencies even though nothing imports them.
