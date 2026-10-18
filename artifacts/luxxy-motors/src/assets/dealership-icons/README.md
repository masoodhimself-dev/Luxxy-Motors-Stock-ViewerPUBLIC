# Dealership Icons · complete family v2.0

100 individual SVG icons: the 98 original concepts, plus automatic transmission and a separate customer enquiry symbol. The approved 12 sample drawings are retained exactly, with transmission.svg now explicitly named transmission-manual.svg. WhatsApp is unchanged byte-for-byte.

## Use the correct transmission symbol

- `transmission-manual.svg`: the approved H-pattern, for known manual cars only.
- `transmission-automatic.svg`: a single selector beside a stepped gate, for automatic cars (including DSG/DCT/CVT where the vehicle data identifies an automatic transmission).
- Unknown or missing transmission: show the text “Not specified” and omit the transmission icon. Do not silently substitute the H-pattern.

The interface proof demonstrates this rule: its automatic Volkswagen uses the automatic selector. Both transmission icons are compared at 16, 20 and 24 px on light and dark backgrounds.

## Contents

- `icons/`: all 100 individual SVGs, with no dependencies.
- `preview.html`: completely offline, script-free UI examples and complete native-size light/dark catalogue. CSS controls select 16/20/24 px in the UI. Catalogue sizes stay fixed. Filenames download embedded SVG files; expandable source is selectable for copying.
- `context-proof-20px.svg`: vector-only static proof of both transmissions and realistic light/dark interfaces. Lettering is outlined; the HTML preview retains selectable text and native-size controls.
- `sprite.svg`: optional symbols with IDs `dealer-<filename-without-extension>`.
- `source/dealership-icons-master.svg`: editable vector master, one named group per icon in manifest order. Unflattened paths and live strokes; no text or font objects. Each icon’s local geometry is still 24 × 24. The master artboard is larger because it contains the whole family.
- `source/geometry.json`: editable vector element data and common drawing settings.
- `manifest.json`: complete labels, categories and filenames.
- `migration.json`: explicit renames and transmission usage rule.
- `COMMERCIAL-USE.txt`, `THIRD-PARTY-NOTICES.txt`, `brand-source.json`: rights and provenance.

## Integration

All individual files use a 24 × 24 viewBox and currentColor. All 99 custom line icons use 1.85-unit rounded strokes, caps and joins. WhatsApp is the original filled brand glyph. Set width and height to 16, 20 or 24. Native stroke widths are approximately 1.23, 1.54 and 1.85 screen pixels respectively. Keep strokes scaling with the icon; do not apply non-scaling-stroke.

Use inline SVG to inherit CSS text colour. An SVG loaded through an HTML `<img>` does not inherit the parent’s CSS colour. The optional sprite works when served from the same origin, for example:

```html
<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
  <use href="/icons/sprite.svg#dealer-transmission-automatic"></use>
</svg>
```

Adjust the URL to your installation. Individual SVGs do not need the sprite. In JSX, convert stroke-width / stroke-linecap / stroke-linejoin to strokeWidth / strokeLinecap / strokeLinejoin.

Label icon-only controls. Use aria-hidden="true" for decorative icons beside text. Keep readable text for transmission, emissions and stock status; icons alone are not certifications. The QR icon is an interface symbol, not a scannable QR code. Chevron points right and can be rotated for other directions.

## Filename changes

`transmission.svg` becomes `transmission-manual.svg`; `calendar-test-drive.svg` becomes `test-drive-booking.svg`. There is no ambiguous generic-transmission alias. All other original names are preserved. `customer-enquiry.svg` is separate from `conversation.svg`.

## Small-size refinements

QR retains three clear finders and fewer data strokes. Merge customers uses two heads and converging paths. Licence check loses a redundant text line. Compare cars uses one vehicle and a two-way comparison arrow. Hybrid loses an unrelated lower arc; charging uses a clean plug. Vehicle history retains a clock while service book uses the approved bound logbook. Documents follow the invoice’s clipped page corner; receipts remain narrow till slips. Familiar navigation and status metaphors keep their conventional shapes with the unified stroke and spacing.

WhatsApp remains subject to Meta’s terms and is the only third-party visual asset. Use its supplied black, white or green colours, as documented in the provenance note.
