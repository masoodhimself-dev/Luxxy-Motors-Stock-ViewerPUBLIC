# Dealership icon family

Installed from the supplied `dealership-icons.zip` on 18 October 2026.

- Original 98 SVGs, manifest and supplied provenance: `artifacts/luxxy-motors/src/assets/dealership-icons/`.
- Shared React components: `artifacts/luxxy-motors/src/components/icons/index.tsx`.
- SVG geometry is stored locally in `glyphs.json`; no icon CDN, remote sprite or external SVG references are loaded.
- Import icons from `@/components/icons`. Existing component names are compatibility aliases; use semantic exports such as `Invoice`, `Receipt`, `Engine`, `Transmission`, `BodyType`, `SignedDeclaration`, `StockImport` and `Demo` for new interfaces.

The supplied family uses a 24-unit viewBox, round caps/joins and a default 1.8 stroke. Use 16px for compact rows, 18–20px for controls and 24px for prominent navigation. Keep button hit areas independent of icon dimensions.

All components forward refs, CSS classes, size, stroke, fill, aria and data attributes. Chevron rotations occur inside the SVG so animation transforms still work. Icons beside text are decorative; icon-only controls require a label on the control.

The official supplied WhatsApp glyph retains its filled geometry and uses brand green by default, with an optional `--dealer-whatsapp-icon` black/white/green override for the surrounding surface. Other social marks retain their existing identities. Review stars and a small set of technical controls absent from the kit (loading indicator, device preview, drag handle, sidebar, delivery truck, key, trend, daylight and handshake) retain familiar artwork with the shared stroke weight. Selection dots and bare ticks remain geometric controls rather than misleading status badges.

Dealer logos, actual generated verification QR codes, favicons and notification application icons are separate artwork and are intentionally preserved. Email/PDF renderers did not contain decorative UI icons and are unaffected.

The source/provenance statements in the supplied pack are retained as supplied, rather than independently certified. WhatsApp remains subject to its brand terms.

Verification covers all 98 supplied glyphs, safe local artwork, viewBox, sizing/ref/accessibility, saved-state fills, directionality and key website/portal/platform aliases. Responsive review includes 390px phone, 820px tablet and 1280px desktop widths.
