# Balanced precision integration

Source: user-supplied dealership-buttons-production.zip, approved option 3.
The vendor TSX and CSS are retained with their notices. Production imports the
vendor CSS in the components layer, then host.css. The existing ui/button.tsx is
an adapter: its Button, buttonVariants, Slot/asChild contract, variants and refs
remain available to every customer, portal and platform consumer.

Existing Tailwind semantic colour utilities remain authoritative. host.css
suppresses the vendor's extra pseudo-element surface only for adapted buttons.
The host supplies its existing Inter font, weights and dealer colour variables;
no review themes, demo scripts, fixtures or replacement icons are shipped.
Existing icons continue through components/icons. The hero search and four
vehicle contact actions also receive the approved geometry.

Existing Radix dropdowns, dialogs and focus handling are retained. Do not migrate
them to ActionMenu just for a visual change. The vendor exports are available for
future isolated use; their menus need their own integration checks before use.
Photo thumbnails, calendar cells, navigation tabs, record rows and drag handles
are specialised controls, not primary action buttons, and retain their layout.

Shared buttons: 48px standard, 44px compact/icon, 52px prominent minimums; 6px
corners, 20px direct SVGs, no pressed-position movement. Existing explicit
page-specific typography and colour overrides are retained. Native disabled and
aria-disabled/loading actions are guarded; forms must retain their existing
request-level duplicate protection. Optional status labels reserve their width.

Verification: full frontend suite, typecheck and production build; responsive
customer, portal and platform browser checks. No backend, stock-worker,
credentials or schedule changes.
