# Showroom analytics

Replit injects analytics into the published website when analytics is enabled in Publishing settings. Development builds safely ignore these events.

No event includes a registration number, vehicle ID, search term, customer detail, message, appointment time, or other free-form value.

## Events

| Event name | Description |
| --- | --- |
| `showroom_filter_applied` | A buyer applies the filter panel or a fixed quick filter. Includes bounded filter flags, filter/result counts, sort choice, and source. |
| `stock_view_changed` | A buyer switches between card and compact stock layouts. |
| `stock_results_opened` | A buyer reveals the stock results from the hero or “view all” control. |
| `carousel_control_used` | A buyer pauses, plays, or manually moves the featured-car carousel. |
| `vehicle_opened` | A buyer opens a vehicle from the showroom, featured carousel, or similar-cars section. |
| `comparison_changed` | A buyer adds or removes a comparison choice, or reaches the two-car limit. |
| `comparison_opened` | A buyer opens the side-by-side comparison from the tray. |
| `booking_started` | A buyer follows a booking route, with its page/section source and whether a vehicle was in context. |
| `contact_clicked` | A buyer taps Call or WhatsApp, with its page/section source and whether a vehicle was in context. |
| `enquiry_submitted` | A valid enquiry is sent to the API. Includes only enquiry type, preferred contact channel, and vehicle-context flag. |
| `enquiry_completed` | The API confirms an enquiry was created. Includes the same safe dimensions as submission. |

## Useful funnels after publishing

Ask these questions after enough traffic has been collected:

1. **Filters to enquiry:** `showroom_filter_applied` → `vehicle_opened` → `enquiry_completed`, split by filter source, sort, and safe filter flags.
2. **Comparison to enquiry:** `comparison_changed` with `action=added` → `comparison_opened` → `booking_started` or `contact_clicked` → `enquiry_completed`.
3. **Vehicle route to contact:** `vehicle_opened` → `booking_started` or `contact_clicked`, split by source and stock-card layout.
4. **Booking completion:** `booking_started` → `enquiry_submitted` → `enquiry_completed`, filtered to `enquiry_type=viewing`.
5. **Contact preference:** compare `contact_clicked` by Call/WhatsApp channel and source, then compare completed enquiries by preferred contact channel.