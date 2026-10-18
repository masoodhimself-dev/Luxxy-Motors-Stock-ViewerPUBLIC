# Dealership Icons

98 individual SVG icons for dealership websites and staff tools. Designed on a 24 × 24 grid with 1.8 px round-capped and round-joined strokes. The WhatsApp glyph is the official filled brand artwork.

## Contents

- `icons/` — individual, self-contained SVG files; descriptive kebab-case filenames.
- `preview.html` — offline searchable catalogue; switch 16/20/24 px and light/dark themes, inspect and copy or download individual SVGs.
- `sprite.svg` — optional symbol sprite; IDs use the `dealer-` prefix.
- `manifest.json` — labels, categories, priority flags and filenames for every icon.
- `brand-source.json` — official WhatsApp provenance and source-file checksum.
- `overview.png` and `overview-dark.png` — contact sheets with 16/20/24 px proofs.

## Styling and usage

All icons use `currentColor` and have a `0 0 24 24` viewBox. No embedded fonts, raster content, scripts or remote references are used in the individual SVG files. Width and height default to 24 and can be overridden to 16 or 20. The 1.8-unit stroke scales naturally with the icon: 1.2 screen pixels at 16 px, 1.5 at 20 px, and 1.8 at 24 px. Avoid setting non-scaling-stroke; it closes small gaps at 16 px.

Use inline SVG or the sprite when the icon needs to inherit text colour. An SVG loaded through an HTML `<img>` does not inherit its parent’s CSS colour.

```html
<button type="button" aria-label="View vehicle">
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <use href="/icons/sprite.svg#dealer-car"></use>
  </svg>
</button>
```

Serve the sprite from the same origin, adjusting the URL to its installed location. The individual files have no dependency on the sprite. For decorative icons beside a text label, add `aria-hidden="true" focusable="false"`. For an icon conveying meaning alone, give its control an accessible label, or add `role="img" aria-label="…"` to the inline SVG. Use text as well as icons for stock and delivery statuses.

In React, convert SVG attribute names such as `stroke-width`, `stroke-linecap` and `stroke-linejoin` to `strokeWidth`, `strokeLinecap` and `strokeLinejoin` when pasting inline JSX. Keep the original numeric viewBox.

The six priority icons are car, mileage, transmission, service-book, calendar-test-drive and invoice. Show/hide is supplied as two separate files. Chevron points right; rotate it ±90° for down/up or 180° for left.

## WhatsApp

`whatsapp.svg` uses unchanged path data from Meta’s official 2026 digital glyph, uniformly scaled and placed within the 24-unit canvas. It is a filled brand asset, not a redrawn outline. `currentColor` is used for integration; set its colour to the provided brand black `#111b21`, white `#ffffff`, or green `#25d366`. The preview uses brand black on light backgrounds and white on dark backgrounds. Do not recolour it to arbitrary UI accent colours or alter its geometry. Allow appropriate clear space in the surrounding layout.

Official source and guidelines: https://www.meta.com/brand/resources/whatsapp/whatsapp-brand/

The WhatsApp asset remains subject to Meta’s brand terms and trademarks. The other icons were drawn for this brief; no third-party icon library is included. Their simple, conventional visual metaphors are not a claim of exclusive design rights.

## Semantic choices

- Calendar/test drive uses a calendar with a start symbol; body-type uses a side profile, while car uses a front profile.
- Available, reserved and sold reuse the same vehicle silhouette with plus, bookmark and check indicators.
- Invoice uses a folded document with a pound symbol; receipt uses a perforated till slip.
- Insurance uses a protective shield; insurance-check adds a checkmark.
- Vehicle-history uses a document and clock; activity-history uses a circular time arrow.
- Success is a circular check; delivered is a double check; error is a circular cross; failed is a diamond cross.
- QR is a navigation/action symbol and is intentionally not a scannable QR code.
- ULEZ/emissions and road tax are interface symbols, not official certification marks.
