# Richer Cars information — 24 October 2026

Branch `codex/cars-richer-details`. Local only; not deployed.

- Uses the desktop row's centre for labelled year, mileage, fuel, gearbox, body type, colour, engine and doors/seats. Shows variant/trim beneath the title without repeating a trim already included in the variant.
- Reuses these facts in the selected car summary. On phones, facts span the full card width below the photo/title/plate, rather than being squeezed beside the image.
- Missing fields are omitted. Zero mileage is retained. Recorded engine capacity in cc is used only when the formatted engine-size field is absent. No facts are inferred from the model name.
- Added existing nullable scalar fields to the staff list/detail projections and local preview: `variant`, `trim`, `body_type`, `engine_size`, `engine_cc`, `colour`, `doors`, `seats`. No raw source JSON, migrations, new permissions or stock/payment mutations.
- Preparation remains absent from the Cars interface.

Verification: 27 Cars unit tests; five backend/preview tests covering scalar data, archive pagination, tenant boundaries and private-data exclusion; seven responsive browser/workflow checks; typecheck and production build passed. Browser sizes: 390/834/1440 pixels, plus scoped upload tests at 390/820/1440. Existing bundle warnings remain. Live customer data and physical devices were not used for this change.
