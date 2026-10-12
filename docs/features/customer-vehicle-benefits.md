# Customer vehicle benefits and useful equipment

The stock results, ordinary featured cards, vehicle details and saved cars share `vehicleBenefits()` and `vehicleSellingPoints()`. They show supplied facts near the price without decorative icon collections. The compact cards prioritise up to four benefits; full details retain ownership/service-history facts too. The homepage's rolling photo strip remains simple.

## Rules

| Highlight / search choice | Required supplied facts |
| --- | --- |
| ULEZ emissions standard met | Recognised petrol fuel with Euro 4 or newer, or recognised diesel fuel with Euro 6 or newer. Petrol/diesel hybrids need an explicit corresponding fuel type and emissions class. No inference from age, model, trim or number-plate OCR. |
| Up to 30,000 miles | An actual finite non-negative integer `mileage` of 30,000 or less. A string or missing mileage is insufficient. Mileage is independent of ULEZ. |
| Advertised annual tax up to £35 | Explicitly annual tax in running-cost items or named annual fields. £0–£35 qualifies, including the boundary. Missing, ambiguous, monthly, malformed or conflicting annual figures do not qualify. The displayed amount remains labelled **advertised**, and does not promise today's DVLA rate. |
| Insurance groups 1–15 | A supplied legacy group on the 1–50 scale, preserving recognised A/D/E/G/P/U suffixes. Conflicting, out-of-range or new Vehicle Risk Rating data is not interpreted as a legacy group. This selection describes a lower group, not a guaranteed insurance price. |

ULEZ is an emissions-standard comparison based on the listing, not a TfL registration lookup. Vehicle details and the stock filter dialog visibly link to the [TfL vehicle checker](https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/ulez-vrm-checker); no unverified/OCR plate is submitted to it automatically. Source-backed explanations open on hover, keyboard focus or tap. Annual tax and insurance qualifications remain available with the exact figure.

Search choices have current public-stock counts, combine with other filters, survive URL sharing/reload, and can be removed or reset. Choices with no supplied matches are hidden unless already selected. Sold/archived/hidden cars are excluded. The former **Low miles** shortcut now actually filters at 30,000 instead of merely sorting all cars.

The first eight features on vehicle and saved-car details prioritise supplied CarPlay/Android Auto, parking cameras/sensors, cruise control, climate/heated seats, navigation/Bluetooth and ISOFIX. Exact text and every remaining feature are retained. Missing, faulty or negatively described equipment is never promoted as a positive feature. The source records and `vehicleContent()` output order are not rewritten.

## Research behind the presentation

- [cinch stock search](https://www.cinch.co.uk/used-cars): concise factual card rows and useful filters with counts.
- [Auto Trader advert guide](https://www.autotrader.co.uk/content/advice/finding-the-right-car): emissions and running-cost information helps buyers compare vehicles.
- [TfL car standards](https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/cars): Euro 4 petrol / Euro 6 diesel thresholds; customers should check their specific vehicle.
- [GOV.UK vehicle-tax rates](https://www.gov.uk/vehicle-tax-rate-tables): tax rules depend on first registration, fuel and other conditions and may change. No new tax amount is calculated by this UI.
- [Thatcham Vehicle Risk Rating](https://www.thatcham.org/a-dynamic-new-system-for-assessing-vehicle-risk/): the newer system replaces legacy group ratings for new model introductions; the two scales must not be conflated.

## Verification

Tests cover eligibility boundaries, absent/conflicting data, no year/variant inference, suffix preservation, equipment ordering, matching filter counts, combined searches, URL/reload/reset, touch explanations and public stock/detail/saved layouts. Browser checks use fictional intercepted stock and block API writes. No additional provider calls, database migrations, dealer settings, stock imports or Grok schedules are introduced.
