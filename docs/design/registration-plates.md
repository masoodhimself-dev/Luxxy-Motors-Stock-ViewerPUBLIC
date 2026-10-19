# Registration plate groundwork

Shared component: `src/components/uk-number-plate.tsx`; presentation only.
Formatter: `src/lib/registration-display.ts`. Database values, import parsing,
registration validation and invoice/payment records are unchanged.

- White front / yellow rear; small, medium and large sizes.
- Real accessible, selectable text; no rasterised lettering.
- Current `MM00 MMM`, prefix `M222 MMM`, suffix `MMM 222M`, dateless/NI
  `MMM 3333` / `MMM 222` and reversed dateless groupings are retained.
- Display spacing is separate from editable form values, so typing does not
  insert spaces or move the caret. Existing part-exchange input constraints stay.
- Missing/age-only values display `Registration not added`, never a fabricated
  plate. Existing car/year labels can still be shown outside this component.
- Existing public part-exchange, booking and comparison consumers use the shared
  component. Customer vehicle identity and staff inventory rows now use it too.
- Bulk entry retains its existing input, focus/ref and optimistic-locking save
  workflow; its font can be set with the same variable as the display component.

## Pending approved artwork

No new font or flag is installed yet. The fallback is the existing application
font, not a claimed legal registration font. After approving the final package:

1. Inspect SVGs and font licence, including web embedding and PDF embedding rights.
2. Self-host the licensed font, define `@font-face` with `font-display: swap`, and
   set `--app-registration-font` to its family (with the existing fallback).
3. Place the reviewed Union Flag/UK vector into the optional `identifier` slot.
   The identifier is decorative; the registration remains the accessible label.
   Omit the slot for flag-free compact instances. Never load remote artwork.
4. Compare the approved small/medium/large geometry against the stock, vehicle,
   form and staff queue contexts before enabling the final treatment.
5. Integrate the same licensed face separately into the server's PDF renderer;
   React/CSS cannot configure PDF embedding. Preserve invoice contents and totals.
6. Recheck phone/tablet/desktop fit, keyboard focus, long valid plates, print,
   contrast, missing data and editable inputs. These are screen components, not
   artwork certified for manufacturing physical registration plates.

The initial groundwork remains local pending the completed design package.
