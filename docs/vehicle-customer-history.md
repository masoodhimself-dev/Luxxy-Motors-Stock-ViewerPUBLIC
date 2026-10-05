# Vehicle and customer history

Staff can open **Portal → History** and choose **Vehicle history** or **Customer history**. Enquiries, stock information, appointments, reservations and saved sales also have direct links to the relevant history.

The vehicle view shows recorded interest from customers and a timeline of enquiries, appointments, follow-ups, reservations, sales, payments, documents and notes. The customer view shows the same recorded activity across their cars. Staff can move between a car and its customers, filter the timeline, and open the original record. Cancelled reservations and vehicles no longer in public stock remain available.

Search supports vehicle titles, registrations, references and customer contact details. The directory and detail views share a desktop layout; narrower screens use a full-width detail view with a Back to list button.

## Matching records

- Explicit enquiry, reservation and sale links take precedence, including when a buyer's contact details were corrected.
- Otherwise, compatible names and normalized email or phone details connect records. UK phone formats such as `07…` and `+447…` match.
- Names alone never connect customers. Shared contacts with contradictory names or email addresses remain separate and show a review note.
- Historic or ad hoc vehicle snapshots remain attached to their records. A valid full registration can connect a snapshot to known stock; a registration year or band alone cannot.
- Anonymous browsing is not attributed to a customer. Missing dates, amounts or details are not invented.

## Data and access

`GET /api/staff/relationships` assembles a read-only view of the existing stores. Production reads are scoped to the configured dealer and require staff authentication. The network preview uses its existing authorized host/origin and active staff controls. Responses are not cached.

The response includes only the history fields needed by staff. Customer access tokens, provider retry state and document archives are excluded. The feature performs no writes, sends no emails, calls no payment providers, and adds no database migration. Editing continues through the original enquiry, reservation or sale screens.

## Verification

- Full workspace type checking and frontend/API production builds.
- 256 frontend unit tests, including nine History component tests.
- Ten relationship aggregation/API tests and three preview access tests.
- Sixteen browser tests covering vehicle/customer links, source-record selection, historical stock, errors and empty states, phone/tablet/desktop layouts, and preservation of unsaved sales.

For the frontend suite on Node 25, run `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @workspace/luxxy-motors run test`. Run relationship backend checks with `pnpm --filter @workspace/api-server run test:relationships`.
