# Dealership icon family

The original 100-icon family comes from the supplied `dealership-icons (1).zip` v2.0. On 19 October 2026, eight concepts were updated from the supplied `dealership-solid-review.html`, using its 16 embedded standard/compact SVG downloads.

- All 100 SVGs, manifest and supplied provenance: `artifacts/luxxy-motors/src/assets/dealership-icons/`.
- Shared React components: `artifacts/luxxy-motors/src/components/icons/index.tsx`.
- SVG geometry is stored locally in `glyphs.json`; no icon CDN, remote sprite or external SVG references are loaded.
- Import icons from `@/components/icons`. Existing component names are compatibility aliases; use semantic exports such as `Invoice`, `Receipt`, `Engine`, `ManualTransmission`, `AutomaticTransmission`, `CustomerEnquiry`, `BodyType`, `SignedDeclaration`, `StockImport` and `Demo` for new interfaces.

The supplied family uses a 24-unit viewBox, round caps/joins and a default 1.85 stroke. Use 16px for compact rows, 18–20px for controls and 24px for prominent navigation. Keep button hit areas independent of icon dimensions.

All components forward refs, CSS classes, size, stroke, fill, aria and data attributes. Chevron rotations occur inside the SVG so animation transforms still work. Icons beside text are decorative; icon-only controls require a label on the control.

The official supplied WhatsApp glyph retains its filled geometry and uses brand green by default, with an optional `--dealer-whatsapp-icon` black/white/green override for the surrounding surface. Other social marks retain their existing identities. Review stars and a small set of technical controls absent from the kit (loading indicator, device preview, drag handle, sidebar, delivery truck, key, trend, daylight and handshake) retain familiar artwork with the shared stroke weight. Selection dots and bare ticks remain geometric controls rather than misleading status badges.

Dealer logos, actual generated verification QR codes, favicons and notification application icons are separate artwork and are intentionally preserved. Email/PDF renderers did not contain decorative UI icons and are unaffected.

The source/provenance statements in the supplied pack are retained as supplied, rather than independently certified. WhatsApp remains subject to its brand terms.

Verification covers all 100 supplied glyphs, safe local artwork, viewBox, sizing/ref/accessibility, saved-state fills, directionality and key website/portal/platform aliases. Responsive review includes 390px phone, 820px tablet and 1280px desktop widths.

Transmission icons use each vehicle’s recorded value. Known manual cars use the H-pattern; known automatic/DSG/DCT/CVT values use the selector. Missing, ambiguous or unsupported values do not receive either icon. Shared comparison headings for mixed cars omit a gearbox icon. The Automatic shopping shortcut uses the automatic selector.

## Solid artwork update

The new supplied solid concepts are car, mileage, insurance, test-drive booking, customer enquiry, invoice, manual transmission and automatic transmission. All other icons remain from v2, including the official WhatsApp mark and separate receipt/insurance-check glyphs. The update changes icon artwork only; site styles, colours, typography, spacing, layout and behaviour stay unchanged.

- Original solid downloads are retained byte-for-byte in `src/assets/dealership-icons/solid/`. Their review-only ink/cobalt defaults are not applied to the interface.
- `solid-glyphs.json` contains the same path/rect/circle geometry split into primary and accent layers. `manifest.json` records the solid and compact source paths alongside the original v2 paths.
- Runtime artwork inherits the existing text/icon colour. A local luminance mask knocks out the detail shapes before painting them at 50% opacity, retaining the two-tone details on both light and dark surfaces without introducing a new palette. Each rendered icon has its own mask ID. No remote SVG, script or external reference is needed.
- Compact artwork is used for explicit pixel sizes up to 16 or base Tailwind `h-4`, `w-4`, `size-4` and smaller. Standard artwork is the default for 20/24px and unspecified CSS dimensions. Responsive CSS overrides retain the base drawing; they do not change any existing dimensions.
- Solid artwork has no outline stroke. Existing caller refs, classes, accessibility, colour and animation handling remain supported. Manual/automatic selection continues to depend on recorded vehicle data.

Tests compare every supplied solid variant’s geometry to its source, verify local mask isolation and colour inheritance, and retain the checks for the rest of the family.
