---
name: Vehicle registration display
description: Why most Luxxy stock cannot show a UK number plate, and the rule for deciding when one may be rendered.
---

Only a small minority of live stock carries a real VRM; assume most cars have none.
The stock feed populates the registration column with a **registration band** such as
`2009 (59 reg)` far more often than an actual plate, and it frequently duplicates that band
into both the registration and registration-band columns.

**Rule:** render a UK number plate only from the authoritative plate/vrm fields, or from a
registration value that positively validates as a UK plate format. Never infer a plate by
comparing registration against registrationBand.

**Why:** an earlier implementation returned any registration that merely differed from the
band, so bands leaked into plate graphics whenever the band column was absent or differed by
whitespace or casing. A yellow plate reading "2009 (59 reg)" reads as fabricated data on a
dealer site whose whole premise is honest disclosure.

**How to apply:** any new surface that shows a plate (cards, detail pages, part-exchange,
enquiry summaries, documents) must go through the shared registration helper and must have a
graceful no-plate layout. Design work must not treat the plate as a required identity anchor
for a vehicle — most cars will not have one.
