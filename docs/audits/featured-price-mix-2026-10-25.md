# Homepage featured-car order — 25 October 2026

Branch: `codex/featured-price-mix`. Local implementation and verification; not deployed.

## Behaviour

- With no staff selections, the homepage starts with the highest-priced available car with a usable supplied thumbnail. It then cycles through lower and middle prices to show a range of stock.
- Staff selections and their chosen order remain first. Stale and duplicate selections are ignored. The existing reserved-last rule remains, including staff-selected reserved cars. Manual photo-less and price-on-application selections remain valid.
- Automatic selection excludes reserved, sold, hidden, archived, withdrawn and explicitly missing-source cars. It excludes absent, malformed and recognisable placeholder thumbnail URLs. Cars with photos but no positive finite price follow priced cars.
- Equal-priced cars retain their source order. Selection is deterministic and does not mutate stock or saved settings.
- The Stock page's existing recommended order and other sorts remain unchanged. The homepage photograph remains independent of featured selections.
- If stock exists but has no suitable automatic photos, full-stock browsing stays available without a false empty-stock message.

No extra image requests, automatic refreshes, migrations, backend changes or dependencies were added. Thumbnail eligibility uses supplied URLs; it does not assess image quality or guarantee a remote image will remain available.

## Checks

| Check | Result |
| --- | --- |
| Helper, homepage and Settings tests | 109 passing across three files |
| Frontend TypeScript | Passed |
| Production frontend build | Passed; existing large-chunk advisory remains |
| Diff whitespace check | Passed |
| Browser phone 390×844 | Highest-priced photo car first; card sizing and next-card peek intact; no page overflow |
| Browser iPad portrait 834×1194 | Two-card layout intact; next/previous carousel controls exercised; no page overflow |
| Browser iPad landscape 1194×834 | Layout intact; no page overflow |
| Browser desktop 1440×1000 | Four-card layout intact; no page overflow |
| Persisted staff override | Saved the fictional preview's £2,750 Ford Focus as a manual pick, reloaded the homepage and confirmed it preceded the £6,775 default car |
| Restore automatic ordering | Removed the test selection, published locally and reloaded; £6,775 Nissan first, £2,750 Ford next, £6,375 MINI third |

Browser checks used the real local React application inside frames with the stated CSS viewport sizes. Screenshots are under `output/featured-price-mix/`. Physical iPhone/iPad Safari testing was not performed. All changed Settings were in the loopback-only fictional preview and were restored; live dealerships and customer messages were untouched.
