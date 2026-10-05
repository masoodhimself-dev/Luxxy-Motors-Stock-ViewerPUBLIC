# Luxxy Motors — Complete Project Guide

**Source review date:** 5 October 2026  
**Purpose:** Owner guide, staff guide and technical handover for the current dealership website and portal.  
**Scope:** The code in this repository. This document does not certify a production deployment, live provider credentials or a completed database migration.

The product is a configurable **used-car dealership website with a staff enquiry, appointment, reservation and sales platform**. Luxxy Motors is the current brand. The same code can be copied and configured for other dealerships.

The parent folder happens to be called “Offline POS KDS system”. This repository is not a restaurant POS or kitchen display system. It also is not an offline-first dealership app: its shared records need a running server.

No real credentials, customer records, payment details or private access links are included in this guide. Examples use fictional values. Some older documents describe earlier designs; the current route files and feature implementations take precedence.

## Contents

1. [What the product does](#1-what-the-product-does)
2. [Current status and boundaries](#2-current-status-and-boundaries)
3. [Customer website and routes](#3-customer-website-and-routes)
4. [Stock browsing and vehicle information](#4-stock-browsing-and-vehicle-information)
5. [Photos, registration numbers and printing](#5-photos-registration-numbers-and-printing)
6. [Contact, phone calls and WhatsApp](#6-contact-phone-calls-and-whatsapp)
7. [Test-drive bookings and calendar](#7-test-drive-bookings-and-calendar)
8. [Reservations and deposits](#8-reservations-and-deposits)
9. [Customer chat](#9-customer-chat)
10. [Dealer portal and staff roles](#10-dealer-portal-and-staff-roles)
11. [Enquiry workspace and follow-ups](#11-enquiry-workspace-and-follow-ups)
12. [Combining enquiries and bookings](#12-combining-enquiries-and-bookings)
13. [Vehicle and customer history](#13-vehicle-and-customer-history)
14. [Sales, payments and handover](#14-sales-payments-and-handover)
15. [Invoices, receipts and customer purchase links](#15-invoices-receipts-and-customer-purchase-links)
16. [Settings and dealership onboarding](#16-settings-and-dealership-onboarding)
17. [Resend, email templates and Stripe](#17-resend-email-templates-and-stripe)
18. [Grok stock feed and daily updates](#18-grok-stock-feed-and-daily-updates)
19. [Technology and repository structure](#19-technology-and-repository-structure)
20. [Data storage and API map](#20-data-storage-and-api-map)
21. [Local development and iPad/phone access](#21-local-development-and-ipadphone-access)
22. [Configuration and secrets](#22-configuration-and-secrets)
23. [Deployment and copying the template](#23-deployment-and-copying-the-template)
24. [Security, spam protection and privacy](#24-security-spam-protection-and-privacy)
25. [Testing, backups and maintenance](#25-testing-backups-and-maintenance)
26. [Troubleshooting](#26-troubleshooting)
27. [Known limits and next development priorities](#27-known-limits-and-next-development-priorities)
28. [Detailed reference documents and glossary](#28-detailed-reference-documents-and-glossary)

## 1. What the product does

Customers can find a used car, inspect its supplied details and photographs, save or compare vehicles, ask questions, book a test drive and reserve an eligible car online. They can contact the showroom through a phone call, a callback request, an enquiry, WhatsApp or website chat.

Staff can work from the same stock, answer questions, record calls, arrange or change appointments, follow up with customers, view related activity, create a sale, record payments and issue documents. Collection and delivery are managed within the sale file.

The owner can change dealership branding, content, photographs, services, booking rules, reservation settings, email wording, staff access and integration configuration.

The main business workflow is:

```text
External stock JSON → validated stock → customer website
                                           ↓
                     enquiry / chat / test drive / reservation
                                           ↓
                              staff enquiry workspace
                                           ↓
                               sale and payment ledger
                                           ↓
                       receipts / invoices / customer page
                                           ↓
                                collection or delivery
```

Customers do not have to book an appointment to ask a question. Staff do not have to book an appointment to log a call. A sale does not require a prior physical viewing.

## 2. Current status and boundaries

| Area | Current implementation | Important boundary |
| --- | --- | --- |
| Customer showroom | Homepage, Browse Stock, vehicle pages, saved cars, comparison, contact and warranty | Used vehicles and full cash prices; no finance calculator or monthly-price sales flow |
| Enquiries and appointments | Website intake, staff intake, ad hoc cars, callbacks, diary, follow-ups and combined cases | Production needs its configured database, staff authentication and applicable migrations |
| Reservations | Persisted reservation flow plus a Stripe Checkout implementation | Simulation/test payments are not real money; live payments need enabled, configured providers |
| Sales | Shared sale files, charges, part exchanges, ledger, documents and handover | Recording money manually does not charge a card or make a bank transfer |
| Customer chat | Contact capture, factual automatic answers, staff handover and linked enquiries | Automatic answers use application code, not Grok or an external AI subscription |
| Dealership settings | Guided setup, content controls, publication history and private integrations | A settings editor, not a drag-and-drop website builder |
| Local network mode | Actual UI with shared, file-backed development services | Development staff identity and local files are not production security or production storage |
| Reusable template | Separate copies, databases, domains, settings and credentials | Not a completed self-service multi-tenant SaaS platform |

Builds and isolated tests establish that code can compile and that tested rules work. They do not prove that Clerk, email, payment, DNS, backups or production PostgreSQL have been commissioned successfully.

Recent migrations are prepared in the repository. They are not applied automatically. In particular, the new enquiry merge migration has not been run against a database as part of this work.

## 3. Customer website and routes

The definitive browser route list is [App.tsx](artifacts/luxxy-motors/src/App.tsx).

| Route | Purpose |
| --- | --- |
| `/` | Homepage: hero/search, featured stock, dealership information, services, reviews and visit information |
| `/stock` | Browse Stock: all visible cars and filtered/search results |
| `/vehicle/:id` | One vehicle: photos, price, supplied details, history, equipment and customer actions |
| `/saved` | Saved shortlist, expanded vehicle information and retained snapshots |
| `/compare` | Side-by-side comparison of up to two selected cars |
| `/enquire` | General, test-drive, warranty, delivery and part-exchange enquiry journeys |
| `/contact` | Showroom contact details, opening hours, directions, parking and enquiry form |
| `/warranty` | Published warranty information and related enquiry links |
| `/viewing/:token` | Private appointment page with status, rescheduling and cancellation |
| `/reserve/payment-return` | Private reservation-payment status after checkout |
| `/my-purchase/:token` | Private, read-only sale summary, payments, documents and handover arrangements |
| `/sign-in` and `/sign-up` | Clerk account access for staff |
| `/portal` | Protected dealer workspace |

The internal enquiry type `viewing` remains in URLs and API payloads even where the customer sees **Book a test drive**. This preserves the existing technical contract.

The removed Find my car service is not an active customer feature. `/sign/:token` and `/customer-details/:token` are withdrawn-service pages; they are not the current sale or signing process. `/portal/sales-demo` is not the current sale entry route. Use `/portal?section=sales`.

The homepage and stock page share components so branding, photography, vehicle facts and search behavior stay consistent. Responsive layouts adapt to desktop, tablet and phone; touch interaction supports swiping where applicable. Customer controls should remain readable and usable without covering the vehicle or dominating a small screen.

## 4. Stock browsing and vehicle information

### Search and results

Browse Stock supports stock-derived make/model choices, budget, fuel and transmission filters, explicit insurance-history filtering, sorting and different result layouts. Search can use vehicle title, make, model and supplied registration information. The natural search parser recognizes supported phrases such as “under £10k”; it is deterministic code rather than an AI API call.

Search state and browsing position are retained so returning from a vehicle does not unnecessarily lose the customer's place. Results are displayed in batches. Reset and See all cars provide a route out of a restrictive search.

Public stock excludes sold, archived and hidden vehicles. Reserved cars can remain visible with their actual status. Stock refreshes periodically; a page being open does not permanently guarantee that a car remains available. Booking and reservation actions recheck availability on the server.

### Vehicle details

Where supplied, a vehicle can show:

- Make, model, title, derivative/variant, year, registration band and actual number plate.
- Cash price, price history/reduction and availability.
- Mileage, fuel, transmission, body style, engine, doors, seats and colour.
- Dealer description and features/equipment.
- Service history, owners/keepers, keys and insurance/write-off information.
- Rich specification groups, running costs, emissions, fuel consumption and source highlights.

Imported JSON structures are translated into readable labels rather than displayed as raw objects. Missing information is omitted or identified as unknown where the customer needs that distinction. A failed data fetch must not be turned into a claim that a car has a clean history, full servicing or a particular equipment item.

Positive supplied facts can be highlighted near the top, such as low annual tax, a small number of previous keepers or documented service history. Other supplied history remains accessible. Presentation choices do not alter the source facts.

### Saved cars and comparison

Saved cars and comparison choices are held in that browser's storage. They are not a customer account that automatically synchronizes between devices. Saved snapshots retain useful context when a vehicle is no longer in the current public feed. Shared shortlist links are supported.

Comparison supports two selected cars and uses available facts. Recently viewed vehicles are limited to eight entries and expire after 30 days.

Relevant sources: [home.tsx](artifacts/luxxy-motors/src/pages/home.tsx), [car-detail.tsx](artifacts/luxxy-motors/src/pages/car-detail.tsx), [stock-context.tsx](artifacts/luxxy-motors/src/lib/stock-context.tsx), [natural-stock-search.ts](artifacts/luxxy-motors/src/lib/natural-stock-search.ts).

## 5. Photos, registration numbers and printing

### Photographs

The stock feed supplies image URLs and optional truthful captions. The app provides consistent framing, a vehicle gallery and an enlarged lightbox. Failed vehicle photographs are removed from the gallery rather than left as broken thumbnail tiles. Transitions are restrained and reduced-motion preferences are supported.

Showing a photograph is different from uploading or hosting one. Stock images normally remain on the source CDN. Dealership presentation photos use configured hosted URLs or repository assets. A general photo-upload/media-library service has not been built.

For part exchange, the agreed customer flow uses WhatsApp for sending photographs. The website does not silently upload those photos to a dealership storage bucket.

### Registration numbers

An actual registration/VRM is used when the supplied data supports it. A registration year or band, such as `2016 (65 reg)`, is not a full number plate and must not be treated as one. If the VRM is absent, the established year/band display is retained. The app does not guess a registration from a photograph.

The shared registration helpers are in [registration.ts](lib/vehicle-meta/src/registration.ts). Registrations can also help staff search records and connect a historical vehicle snapshot to known stock where a valid full registration is available.

### Print vehicle details

The current customer action is **Print vehicle details**. It prepares an A4 sheet containing mapped supplied information: identity, price, selected photographs, facts, dealer description, features, specification groups, running costs and history, with dealership details where valid.

The print component waits briefly for its images, removes failed photographs, measures the sheet at physical print size and adjusts density. It does not silently truncate text. If unusually large supplied content cannot fit one readable A4 page, it reports that limitation instead of clipping it or inventing a shorter description. Browser paper size, scale and header/footer settings can still affect the physical output.

The print action can also be saved as PDF through the browser's print dialog. The older read-only `/api/vehicles/:id/brochure.pdf` endpoint remains implemented as a separate server PDF renderer; it can produce a multi-page document. It is not the current one-page browser print action. Older PDF documentation describes that earlier behavior.

Relevant sources: [vehicle-print.tsx](artifacts/luxxy-motors/src/components/vehicle-print.tsx), [vehicle-print-data.ts](artifacts/luxxy-motors/src/lib/vehicle-print-data.ts), [vehicle-brochure.ts](artifacts/api-server/src/lib/vehicle-brochure.ts).

## 6. Contact, phone calls and WhatsApp

The call dialog keeps the selected vehicle visible and uses the dealership's published opening hours. On desktop it can display the showroom number and car details. On a phone it can hand off to the device's telephone application. The website cannot establish whether a call actually connected.

Follow-up choices offer an appropriate online question or eligible reservation action. When the showroom is closed, customers can request a callback. The request requires a name and telephone number; email is optional. It is a general enquiry attached to the vehicle, not an appointment.

The server chooses the callback due time from stored hours in `Europe/London`: now while open, or the next determinable opening while closed. Missing or ambiguous hours leave it unscheduled for staff to review. A callback promise depends on staff actually working the queue.

WhatsApp displays a message for the customer to review before opening WhatsApp. Vehicle context is included where relevant, and the message is kept concise. Opening the WhatsApp URL is not the same as sending a message; the customer sends it in WhatsApp. No WhatsApp Business messaging API has been configured by this feature.

The contact page provides address, directions/map link, opening hours and parking/arrival instructions. Those details come from settings and must be completed for each dealership.

## 7. Test-drive bookings and calendar

### Customer journey

1. Select a vehicle, or arrive from that vehicle's Book a test drive action.
2. Choose an available date and time.
3. Supply the required contact information and any optional relevant notes.
4. Review and submit.
5. Receive a confirmed appointment or a clearly identified request awaiting staff approval, according to the dealership policy.

Customers cannot book a vehicle-specific test drive without selecting a car. The server checks current car availability and booking policy rather than trusting the browser's choices.

### Booking settings

Owners control booking enablement, instant confirmation versus staff approval, duration, buffers, advance notice, capacity, booking window, weekly hours, blocked dates and instructions. Pending approvals and confirmed appointments both consume capacity. Pending requests currently do not have an automatic expiry policy.

### Staff appointments

The enquiry workspace and calendar display website and staff-created appointments together. Staff can create, approve, decline, reschedule or cancel appointments and record attendance. They can deliberately book outside published hours or double-book when permitted by the staff flow; exceptions are warned about and marked clearly, with explicit acknowledgement.

Booking changes use current revisions. Production capacity checks use database locks so two customers cannot safely assume the same remaining slot just because both browsers displayed it.

### Customer management link

`/viewing/:token` provides private appointment status, confirmed calendar information, rescheduling through available slots and explicit cancellation. An awaiting-approval request is not presented as confirmed. Changes are unavailable after the appointment has started. A cancelled appointment remains in history.

Marking an enquiry closed does not by itself cancel an appointment. Staff should use the appointment cancellation action when the slot should be released.

Sources: [test-drive-booking.tsx](artifacts/luxxy-motors/src/components/test-drive-booking.tsx), [viewings.ts](artifacts/api-server/src/routes/viewings.ts), [booking-slots.ts](artifacts/api-server/src/lib/booking-slots.ts), [enquiry-calendar.tsx](artifacts/luxxy-motors/src/components/portal/enquiry-calendar.tsx).

## 8. Reservations and deposits

**Reserve car online** is controlled by the owner in Services. It has a configurable deposit and reservation terms. Disabled reservations disappear from customer actions and are rejected by the relevant server policy. Existing records remain available to staff.

The customer selects an available stock car, provides contact details, reviews the current vehicle/deposit/terms and accepts the terms. The server controls the amounts and availability.

There are distinct payment paths:

| Path | What happens | Money received |
| --- | --- | --- |
| Development simulation | Creates a persisted reservation in the permitted development flow | £0 real money received |
| Stripe test confirmation | Tests the provider flow in an eligible non-production environment | £0 real money received; not a live deposit |
| Stripe live Checkout | Uses hosted checkout and waits for a verified payment event | Confirmed live deposit only after server verification |

Production rejects simulated reservations and rejects enabling live checkout with Stripe test mode. Turning the reservation switch on alone does not establish payment readiness.

Stripe creates a temporary vehicle hold. Abandoned holds are released only when the recovery policy establishes that release is safe. An uncertain network response is not proof that no customer paid.

Staff see references, customers, cars, status and recorded payment/refund information. Cancellation keeps the history. Releasing a car must not override a conflicting sale, confirmed money or another valid hold.

A genuine online deposit can connect to the sales ledger and issue a receipt. A simulated reservation must never be promoted into a received deposit when a sale is started.

Reference: [online-reservations.md](docs/online-reservations.md) and [integrations-email-payments.md](docs/integrations-email-payments.md). Their older simulation descriptions should be read alongside the newer Stripe implementation.

## 9. Customer chat

The website has an **Ask us** button that opens on request. It can carry the car from the current vehicle page. Before starting, the customer must leave a name and at least one valid phone number or email address. A callback requires a phone number.

Starting a chat creates a linked enquiry, even before the first question. Subsequent contact changes and messages remain attached to that conversation/enquiry rather than creating a new record for every message. Older anonymous conversations remain readable, but require valid contact details before further customer messages or handover.

Customers can return to their identified conversations from the same browser. Access uses a random bearer session token with a server-stored hash and a 30-day lifetime. A conversation ID or matching email alone does not authorize access.

### Automatic answers

Automatic answers use current public stock and published dealer settings. Supported topics include price, mileage, fuel, transmission, equipment, opening hours and supplied warranty/delivery information. The code refreshes vehicle facts before further answers.

Missing facts, negotiations, valuations, private transactions and uncertain questions are handed to staff. The assistant does not independently create bookings or payments. It does not use Grok or an external language-model provider.

Automatic replies are attributed to **Showroom assistant**. Human replies carry the staff member's identity. The system does not use fake staff names or promise live assistance without evidence.

### Staff chat

Portal → Chat supports search, waiting/unread/open/resolved filters, transcripts, car and contact context, assignment, takeover, staff replies and resolve/reopen actions. Staff can open the enquiry, arrange a follow-up and move into vehicle/customer history.

“Available” requires a recent staff heartbeat and eligible opening hours. Outside hours, the widget offers a message/callback and next opening where determinable. Availability is not a promise that a particular person will immediately answer.

Owners can enable chat, toggle automatic answers and notifications, and edit the button, greeting and offline copy. Polling keeps the current UI updated; this is not a separate real-time socket service.

Reference: [customer-chat.md](docs/customer-chat.md).

## 10. Dealer portal and staff roles

The active workspace is `/portal`. Its sections use the `section` query parameter:

| Section | URL | Staff use |
| --- | --- | --- |
| Overview | `/portal?section=overview` | Work summary, outstanding tasks, balances, stock health and delivery work |
| Enquiries | `/portal?section=enquiries` | Calls, enquiries, callbacks, stock information, calendar and follow-ups |
| Chat | `/portal?section=chat` | Customer conversations and handover |
| Sales | `/portal?section=sales` | New sale and saved sale files |
| Test drives | `/portal?section=test-drives` | Requests, decisions, appointment status and attendance |
| Reservations | `/portal?section=reservations` | Reservation and payment states |
| History | `/portal?section=history` | Connected vehicle/customer records |
| Settings | `/portal?section=settings` | Website setup, integrations, email, team and history |

Useful deep links include `enquiryId`, `saleId`, `reservationId`, and History's `vehicleId` or customer `record`. They let staff open the relevant record from another workspace.

### Authentication and permissions

Clerk supplies the account identity. The application stores dealership staff roles in `portal_users` and checks permissions on protected API operations. Signing into Clerk is not automatically the same as having dealership access.

| Role | Main responsibilities |
| --- | --- |
| Owner | Sales, payments/refunds, handover, website publication, price overrides, integrations, exports and team management |
| Salesperson | Enquiries, chat, appointments, sales, payment recording and handover |
| Accounts | Read portal records, record/confirm/refund ledger payments and export financial records |

The last active owner cannot be disabled or demoted. Team setup grants roles to an existing registered Clerk account; it does not send an account invitation automatically.

The initial owner bootstrap needs deliberate configuration. If no staff rows or allowlist exist, the first eligible authenticated claimant can become owner. Configure the intended owner/allowlist before exposing a new production portal.

Reference: [dealer-operations.md](docs/dealer-operations.md).

## 11. Enquiry workspace and follow-ups

The enquiry desk uses tabs and a desktop workspace that makes use of screen height and width. It provides Today, New call, Callbacks, All cars, Calendar and record-search views.

Staff can:

- Search current stock and inspect full supplied vehicle information while talking to a customer.
- Enlarge a car photograph to inspect visible colour/registration details without inventing a plate from the image.
- Log an enquiry/call without an appointment.
- Use a stock vehicle, an ad hoc vehicle or a general enquiry without a specific car.
- Assign or claim work, record an outcome and update attendance.
- Append dated conversations and retain earlier messages/notes.
- Request, schedule, complete or change a follow-up.
- Book or change a test drive, or start a connected sale.

Callbacks combine website callback requests with outstanding staff follow-ups. The queue distinguishes overdue, upcoming and unscheduled work. Unassigned work remains visible so it is not lost between staff members.

A conversation log uses the signed-in staff identity, a note, outcome and current revisions. An optional next follow-up is saved together with that log. Without an explicit follow-up change, an existing follow-up remains unchanged; staff complete it through the follow-up controls.

Draft call forms are browser-local and scoped to staff/dealer context. A draft is not a saved enquiry. Shared saved records live on the server.

## 12. Combining enquiries and bookings

Staff with sales-management permission can choose **Merge records** from an enquiry or test-drive entry. The result is one combined case represented by a main enquiry.

This is a non-destructive grouping operation:

- Between two and twenty original records can be combined.
- Existing cases are included as complete groups, not partial fragments.
- Originals keep their customer, contact details, vehicle, message, dated discussions, staff notes, follow-up and customer links.
- Search includes the originals; opening an original desk link resolves to its main case.
- Original details and actions remain accessible within the case.
- Staff explicitly choose which original appointments to keep.
- Any active appointment omitted from that choice is cancelled on its original row; its old history remains.
- Different customer/contact information and overlapping kept appointments require explicit review.
- A reason, authenticated staff identity and membership/appointment choices are recorded in audit history.

Callbacks remain actionable original tasks with a link to their case. Calendar entries remain attached to the exact kept appointments. A merge does not create a new sale, move payments or send a customer email.

The review freezes workspace, appointment and follow-up revisions. A competing contact edit, conversation, status change or booking update invalidates it. A conflict preserves the user's choices but requires refresh and another review. Double submission is prevented in the UI, and the server checks state again.

Explicitly merged records can be shown together in customer history without rewriting the original identities or phone/email values. Mere name similarity is not an automatic merge instruction.

API: `POST /api/staff/enquiries/:id/merge`. Production needs migration `0020_enquiry_merges.sql` before using the new fields/event. See [enquiry-merges.md](docs/enquiry-merges.md) for the request body and detailed rules.

## 13. Vehicle and customer history

Portal → History gives two connected views.

**Vehicle history** shows recorded customers and a timeline of enquiries, appointments, follow-ups, chat, reservations, sales, payments, documents and notes for a car. A historical car does not disappear from its records just because it is no longer public stock.

**Customer history** shows recorded interest and activity across cars. Staff can filter the timeline and open the original enquiry, conversation, reservation or sale.

Explicit source links take precedence. Otherwise, compatible names and normalized contact details can connect records. UK `07…` and `+447…` phone forms are normalized. Names alone do not establish identity; contradictory/shared contact information is kept separate or marked for review. Explicit staff case merges provide a deliberate additional relationship.

This feature is a read-only aggregation of existing stores. Editing happens through the original workflows. It does not attribute anonymous website browsing to a named customer, expose customer capability tokens or make provider calls.

Merged case counts distinguish a combined enquiry from its separately kept appointments. Original references and discussions remain visible.

Reference: [vehicle-customer-history.md](docs/vehicle-customer-history.md) and [dealer-relationships.ts](lib/vehicle-meta/src/dealer-relationships.ts).

## 14. Sales, payments and handover

### Sale file

Use **New sale** in the portal. The active SalesWorkspace lives in `src/pages/sales-demo.tsx` despite that historical filename; it is a persisted workspace, not the retired sales demo URL.

A sale has six main areas: Customer, Vehicle, Part exchange, Payments & receipts, Documents, and Delivery & handover.

Customer and vehicle context can be pulled from a recent enquiry or reservation. Source UUIDs remain linked so history can follow the sale back to the original interest. Selecting the same source can reopen its existing sale. Importing contact details does not automatically credit a deposit.

### Agreed money

The sale supports agreed vehicle price, fees, discounts and up to three part-exchange cars. Examples include administration or delivery charges and an agreed discount. Part-exchange allowances reduce the amount due.

Financial calculations use integer pence, avoiding floating-point rounding drift.

```text
Amount due = agreed vehicle price + charges − discounts − part-exchange allowances
Balance    = amount due − confirmed net payments
```

Pending payments do not enter confirmed net payments. Confirmed refunds and corrections are recorded as separate signed entries. Customer credit, when applicable after provider corrections, remains visible until reconciled.

### Payments over time

A customer can pay a deposit, several part payments and a final balance through different recorded methods, such as bank transfer and cash. Each confirmed received payment can issue its own receipt.

Staff must explicitly confirm that money was received. Expected money can be entered as pending, then confirmed later with its actual received date. A cancelled pending payment remains in history. A final-payment entry must settle the current balance; smaller received amounts are part payments.

Selecting “card” as a manually recorded method does not charge a card. Recording a manual refund does not initiate a bank transfer or Stripe refund. A real provider payment enters through the verified provider bridge.

### Availability and handover

Staff can reserve or mark the vehicle sold through sale lifecycle controls. Conflicting sale/reservation states are checked under the shared vehicle lock. A sold file cannot simply be released as available.

Collection and delivery are independent of whether the buyer viewed the car. Staff record the arrangement, date/time window, recipient and instructions; delivery also needs an address. Delivery charges are added once through the agreed charge controls.

Preparation checks, documents and recipient confirmation support handover. A remaining balance requires explicit acknowledgement when completing delivery/collection. Marking the car delivered or collected does not fabricate payment or settle the balance.

A sale can continue after the car leaves the public stock feed. Its saved vehicle facts remain associated with that same car; changing to another vehicle cannot inherit unrelated old facts.

Reference: [sales-lifecycle.md](docs/sales-lifecycle.md) and [sale-workspace.ts](lib/vehicle-meta/src/sale-workspace.ts).

## 15. Invoices, receipts and customer purchase links

### Documents at each stage

| Customer situation | Appropriate system record/document |
| --- | --- |
| Deposit received | Individual payment receipt showing that deposit, cumulative confirmed money and balance at issue |
| Another part payment received | A new receipt; the earlier deposit receipt remains unchanged |
| Final balance received | A final payment receipt reflecting the settled balance |
| Customer needs an invoice before full payment | Issued sales invoice showing the agreement; not proof that money was received |
| Customer asks what remains outstanding | Current balance statement |
| Agreement changes after an invoice | New invoice version, with earlier issued versions retained |
| Refund or correction | Separate linked ledger entry/document; original payment and receipt retained |

Issued documents store snapshots of the customer, vehicle, dealership branding, agreement and relevant ledger state. Later settings changes or payments do not silently rewrite an old receipt.

New issued documents have a deterministic server PDF archive and checksum. Older snapshot documents can export their saved facts without rewriting history. Staff can print, download or request email delivery of saved documents. Email status is tracked independently from payment status.

Request identifiers protect retries from duplicating payment or document numbers. Revision checks reject stale staff edits and preserve unsaved input until staff reload deliberately.

### Private purchase page

Staff can create, replace or revoke a private `/my-purchase/:token` link. The token uses cryptographically random data; storage contains its hash, expiry and revocation state. Current links last 30 days. The full link is displayed only when created and can be sent through the configured email action.

The customer page is read-only. It shows permitted sale/vehicle information, outstanding balance, confirmed and pending payments, issued documents/PDFs, and collection/delivery arrangements. It is not a customer identity-editing or e-signature form.

Private projections omit staff notes, staff attribution where inappropriate, provider mapping/retry state, token hashes and raw PDF archives. Changing the buyer identity or vehicle revokes access. Customer document lookup is constrained to the authorized sale.

Sources: [customer-sale.ts](lib/vehicle-meta/src/customer-sale.ts), [sale-document-pdf.ts](artifacts/api-server/src/lib/sale-document-pdf.ts), [customer-sale.tsx](artifacts/luxxy-motors/src/pages/customer-sale.tsx).

## 16. Settings and dealership onboarding

Open Portal → Settings. Website setup offers ten steps and an all-sections mode:

1. Brand.
2. Showroom/contact information.
3. Photographs and visiting information, including booking policy and customer reviews.
4. Homepage.
5. Page wording.
6. Services and reservations.
7. Dealership trust/selling points.
8. Printed details.
9. Business details.
10. Review and publish.

Website edits remain a browser-tab draft until published. Drafts expire after 24 hours. Validation and publication conflicts retain edits so the owner can correct or reload deliberately.

### Editable areas

| Area | Owner controls |
| --- | --- |
| Identity | Dealer name, text/image logo, separate footer logo, favicon, primary/accent colours and supported surface/text/link overrides |
| Contact | Telephone, WhatsApp, email, address, postcode, map link and opening hours |
| Photographs | Hero, showroom, team, forecourt/visit, contact and reception placements; alternative descriptions and hero focus |
| Homepage | Headline, introduction, announcement, search wording, supported section switches, eligible recent handovers and up to eight ordered featured choices |
| Customer wording | Navigation, stock, vehicle, enquiry, contact, warranty, saved and comparison headings/introductions through a typed catalogue |
| Services | Warranty, delivery and part-exchange copy/visibility, reservations/deposit/terms |
| Booking | Enablement, approval policy, duration, buffer, notice, capacity, window, hours, blocked dates and instructions |
| Reviews | Supplied review JSON, source, name/date/rating, verified/invited metadata, visibility and source link |
| Trust | Trust points, why-buy wording and related supported content |
| Print | Supported vehicle print branding/styles and footer wording |
| Company/footer | Company/VAT numbers, social links, policy links, introduction and footer identity |
| Email | Templates, permitted variables, shared email logo/colour/heading/footer |
| Integrations | Private Resend/Stripe configuration and enablement |
| Chat | Enablement, automatic answers, notifications and customer-facing copy |
| Team | Existing staff account access, role and active status |
| History | Read published versions and restore a previous version as a new publication |

An empty page-copy override returns to the standard wording. Copy is rendered as text, not arbitrary HTML. Stock facts, money, availability and customer records are operational data, not marketing settings.

Settings publication uses a revision/ETag. Missing expected revision returns 428; an outdated revision returns 409. Publication history is retained. Restoring an old version creates another publication rather than deleting newer history.

Logo/photography URLs must be hosted appropriately; new presentation images require HTTPS. There is no direct upload storage, no unrestricted theme builder and no control for every incidental application label. Colour edits need visual review for readable contrast.

Review badges reflect supplied metadata. The application does not independently verify a Google review or send review invitations through this editor.

References: [dealership-onboarding.md](docs/dealership-onboarding.md), [website-content.ts](artifacts/luxxy-motors/src/lib/website-content.ts), [dealer-settings-panel.tsx](artifacts/luxxy-motors/src/components/dealer-settings-panel.tsx).

## 17. Resend, email templates and Stripe

### Private API settings

Owners use Settings → API integrations. Provider keys are separate from public dealership settings. Responses report configured status rather than returning secrets or fragments. Blank key fields retain a saved key; explicit removal clears it.

Production private settings are encrypted with AES-256-GCM. They need a stable 32-byte encryption key and persistent private file storage. Directory/file permissions are restrictive. The encrypted file store is designed for one API process on one host; it is not a replicated secrets database.

### Resend

The application sends through the configured Resend account and verified sender. Supported templates cover enquiries, dealer notifications, callbacks, appointment lifecycle/reminders, reservations/payments/refunds, invoices, receipts, statements, other sales documents and private purchase links.

Owners edit subjects/bodies and shared branding. Permitted variables include customer/dealer names, reference, vehicle, appointment, document and link information; the editor lists the allowed set. Invalid variables and multiline subjects are rejected. Values are escaped, and essential factual appointment/financial details are appended by the system.

Document emails attach the issued PDF archive. Disabled or failed email does not become “sent” and does not change the ledger. Provider acceptance is submission to Resend, not evidence that the customer read the email.

### Stripe

Stripe uses hosted Checkout, so card data does not pass through these forms. The server calculates the deposit, checks stock/terms and creates the hold/session with stable retry identifiers.

Configure the signed webhook at `/api/reservations/stripe/webhook` for the events listed in [integrations-email-payments.md](docs/integrations-email-payments.md). The handler checks the original raw body, signature/timestamp, session, dealer, reservation, amount, currency, mode and actual paid status.

A browser returning from Stripe does not confirm payment. Only accepted server verification records received money and creates the linked deposit receipt. Duplicate events do not create duplicate deposits.

Provider-confirmed refunds enter as separate ledger entries. Pending refunds are not booked as successful. If a succeeded refund later fails/cancels according to a verified status event, a corrective entry restores the amount; original entries/documents stay intact. Ambiguous or incomplete situations are marked for review.

The recovery/expiry worker checks periodically, retaining uncertain holds and recovering interrupted checkout creation with the same request identity. This avoids treating a timeout as proof of nonpayment.

### What “Validate saved settings” proves

It checks required fields, formats and key/mode consistency locally. It sends no test email, creates no checkout and does not prove provider connectivity. Sender-domain verification, webhook provisioning and actual staging/live acceptance remain operator tasks. The LAN development server never contacts these providers, even when private fields are filled in.

## 18. Grok stock feed and daily updates

### Division of responsibilities

Grok Bot runs externally and produces the stock JSON. This website does not run Grok, control its computer or schedule its scraping. At runtime Grok communicates with the website API, not the coding assistant.

Grok owns collection, source comparisons and cache management. The backend owns validation, persistence, import safeguards, dealer overrides, availability and public stock projection. A scraper should only use the stock integration routes, not customer or sales routes.

### Import contract

`POST /api/stock/imports/grok` requires `Content-Type: application/json` and the `x-stock-import-secret` header. Each dealership deployment has its own secret, retailer ID and backend destination.

The schema-version-1 envelope includes a new `runId`, source `grok`, retailer identity, actual `scrapedAt`, completeness/count information, failed/error lists and `cars`.

Key rules:

- Send the complete current inventory, not a delta or one page of results.
- Accepted completeness requires matching counts, `complete: true`, no failed advert IDs and no reported errors.
- Preserve a unique stable source `advertId` for every vehicle.
- Missing nullable facts remain `null`. Do not invent VRM, service history, mileage or clean insurance history.
- Cash prices are numeric GBP whole pounds in this stock contract. Sales/deposit ledger values use pence internally.
- Images are HTTPS URLs, not embedded base64 files. Captions must be truthful.
- Extra agreed source structures belong in `specifications`/`sourceExtras`, including description, features, rich specs, running costs and history.
- The current category enum accepts S, N or null; other known categories need an agreed mapping/schema change, not concealment as unknown.

The canonical example is [grok-stock-example.json](docs/integrations/grok-stock-example.json). Use the full example/contract when generating a payload; this summary is not a substitute for its required fields.

### Updates and safety

Imports identify a vehicle by source advert ID and keep a website UUID for customer routes. These IDs are different. An unchanged replay using the same run ID and identical content is idempotent; different content under that run ID conflicts.

| Default safeguard | Behavior |
| --- | --- |
| Maximum snapshot age: 24 hours | Reject/quarantine stale collection rather than pretend it is fresh |
| Future timestamp tolerance: five minutes | Reject implausibly future collection timestamps |
| Count drop over 30% | Quarantine suspicious incomplete stock replacement |
| Price below £500 or change over 50% | Flag price for review and protect accepted price as applicable |
| Missing threshold: two accepted snapshots | Hide repeatedly missing adverts without hard deletion |
| Stock-health warning: 36 hours | Warn staff when no complete successful update arrives |

Deployment variables configure the relevant thresholds. `STOCK_SUPPORTED_SCHEMA_VERSION` appears in the environment example, but runtime validation currently supports version 1 directly; changing that variable does not implement another schema.

Missing means **no longer advertised**, not proof that a vehicle was sold. Dealer-controlled reserved/sold/archived states and price overrides are preserved. A later source scrape must not reopen a staff-sold car accidentally.

Price-reduction presentation uses accepted price history; it is not a random claim. Suspicious data does not overwrite the last good public stock merely to make an import succeed. Import health and price overrides are available to permitted staff.

### Efficient external daily checks

The agreed external approach is listing fetch → code comparison → detail refresh only for new/changed adverts → complete snapshot rebuilt from fresh and cached details. Keep actual collection/check/detail freshness distinct. Deduplicate image URLs in code and avoid repeatedly rechecking unchanged successful URLs.

On retry, send the same payload and run ID with bounded backoff. Changed content gets a new run ID. Avoid overlapping/out-of-order jobs; the website does not enforce a strict increasing timestamp order across every accepted run within its age window.

The twice-daily or weekday schedule discussed for Grok is external; it is not a schedule provisioned in this repository. AI-credit usage and source access permissions are determined by that external service, not by this app.

### Import responses

| HTTP | Meaning |
| --- | --- |
| 201 | Imported |
| 200 | Identical completed run replayed |
| 400 | Invalid data/configured retailer mismatch |
| 401 | Import secret missing or wrong |
| 409 | Conflicting reuse of run ID |
| 422 | Quarantined snapshot requiring investigation |
| 500 | Configuration or unexpected failure; inspect safe error details |

There is no dry-run flag. An accepted production import changes its database. Validate on a dedicated staging destination first. The current request-body limit is 25 MB. Although a payload-limit error would normally be HTTP 413, the current global error handler converts that parser error to HTTP 500; do not assume every 500 is a transient error worth retrying unchanged. Explicit payload-limit response handling is a maintenance item.

Reference: [grok-stock-handoff.md](docs/integrations/grok-stock-handoff.md).

## 19. Technology and repository structure

Most application code is **TypeScript**. The browser uses React, HTML/CSS and JavaScript output. The server uses Node.js/Express. Persistent production data uses PostgreSQL and SQL migrations.

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4 and custom CSS |
| Routing/data/forms | Wouter, TanStack Query, React Hook Form, Zod |
| UI/motion | Radix components, Lucide icons, Framer Motion and carousel helpers |
| Backend | Express 5, TypeScript bundled with esbuild, Pino logging |
| Database | PostgreSQL, Drizzle ORM, Drizzle migration history |
| Staff identity | Clerk |
| Email/payments | Direct Resend and Stripe integrations |
| Documents | Browser A4 printing and server PDF rendering with jsPDF |
| API generation | OpenAPI plus Orval-generated React clients/types and validators |
| Tests | Vitest, Testing Library, Node test runner and Playwright |
| Workspace | pnpm 11.19.0; supported Node engine `>=24 <26` |

```text
repository/
├── artifacts/
│   ├── luxxy-motors/       Customer website, portal, styles and browser tests
│   │   ├── src/            Production frontend source
│   │   ├── preview/        Development-only file-backed API/identity adapters
│   │   └── tests/          Playwright journeys and responsive checks
│   ├── api-server/         Express routes, domain stores, providers and API tests
│   └── mockup-sandbox/     Design experiments; not the deployed dealership app
├── lib/
│   ├── api-spec/           OpenAPI and code-generation configuration
│   ├── api-client-react/   Generated client, types and custom fetch support
│   ├── api-zod/            Generated schemas/types
│   ├── db/                 Drizzle schema, migrations, snapshots and journal
│   └── vehicle-meta/       Shared registration, hours, sales, chat, history rules
├── docs/                   Feature handovers and dated verification notes
├── scripts/                Maintenance/development helpers
├── .env.example            Configuration names, never real credentials
└── PROJECT_GUIDE.md        This guide
```

Production serves the built frontend, API and share routes from one Express service. The browser calls relative `/api` routes. Share pages provide server-rendered vehicle metadata for link previews.

The independent runtime does not require Replit. Historical notes and old filenames may mention it; those references are not proof of a runtime dependency. This is a Node application, not a PHP site that can be deployed completely by uploading static files over FTP.

## 20. Data storage and API map

### Production storage

| Data | Main store/purpose |
| --- | --- |
| Stock, images and vehicle changes | Dealer stock tables, image rows and change/audit history |
| Imports | Import-run results and saved source data |
| Website settings | Dealer configuration JSON and publication versions |
| Enquiries/appointments/follow-ups | Enquiry rows, revisions and append-only events |
| Staff | Clerk identity linked to portal-user roles |
| Chat | Dealer-scoped chat state, transcript, session hashes and staff presence |
| Sales | Sale workspace, numbering counters, ledger and issued document snapshots/archives |
| Reservation/payment states | Existing reservation/lead storage plus provider reconciliation state |
| Private integrations/email configuration | Encrypted private file store, separate from public settings |

Legacy lead/sales tables and routes still exist in source/history. The current visible portal uses the newer enquiry and sales workspaces; old database tables should not be dropped simply because their former UI was removed.

Transactions and advisory/row locks protect critical stock, booking and money changes. Revisions protect against overwriting a colleague's newer edit. Append-only events/documents retain context after changes.

### Important API families

All paths below include the actual `/api` prefix unless noted.

| API | Main use/access |
| --- | --- |
| `GET /api/healthz` | Liveness; not full database/provider readiness |
| `GET /api/stock`, `GET /api/vehicles/:id` | Public visible stock |
| `POST /api/stock/imports/grok` | Secret-authenticated external complete stock import |
| `GET /api/vehicles/:id/brochure.pdf` | Separate read-only server brochure PDF |
| `/share/vehicle/:id` | Server-rendered public vehicle link preview |
| `GET /api/dealer-settings` | Public safe website configuration |
| `PATCH /api/dealer-settings` | Permission/revision-checked publication |
| `POST /api/enquiries` | Public enquiry/booking/callback creation |
| `GET /api/enquiries` | Staff enquiry records |
| `/api/enquiries/availability`, `/api/viewings/:token` | Public availability/private appointment management |
| `/api/staff/enquiries` | Staff intake, workspace, appointment, follow-up, conversation and merge actions |
| `/api/test-drive-bookings` | Staff appointment list and decisions |
| `/api/reservations` | Standard reservation creation/list/cancellation |
| `/api/reservations/checkout` | Stripe-hosted reservation checkout |
| `/api/reservations/payment-status` | Restricted customer payment-status lookup |
| `/api/reservations/stripe/webhook` | Signed Stripe event intake |
| `/api/staff/stripe-reservations` | Staff card-payment reservation worklist |
| `/api/sale-workspace` | Staff sale files, payments, documents, lifecycle and handover |
| `/api/customer-sale/:token` | Restricted private customer sale/document reads |
| `/api/dealer-operations` | Operational summary and permission-gated payment CSV |
| `/api/staff/relationships` | Staff vehicle/customer history |
| `/api/chat` and `/api/staff/chat` | Customer conversations and staff management/settings |
| `/api/dealer-integrations`, `/api/email-templates` | Owner-only private integration/template controls |
| `/api/staff/access`, `/api/staff/team` | Staff permissions and team management |
| `/api/staff/settings-history`, `/api/staff/stock-health` | Publication history and feed health |
| `/api/staff/vehicles/:id/price` | Owner published-price override |

For exact methods/bodies, inspect [mounted routes](artifacts/api-server/src/routes/index.ts) and their modules. [openapi.yaml](lib/api-spec/openapi.yaml) is canonical for generated-client areas, but does not yet exhaustively describe newer chat, sales, relationship, private integration and Stripe endpoints. It also retains some retired contracts. A route listed in an old schema is not proof that it remains active.

Legacy `/api/sales`, `/api/signing` and `/api/customer-intake-sessions` return withdrawn-service behavior rather than running the former process. The current sale API is `/api/sale-workspace`.

## 21. Local development and iPad/phone access

### Two different run modes

**LAN development mode** uses `vite.preview.config.ts`, a development identity adapter, stock fixtures and shared local JSON stores. It renders the real UI without requiring PostgreSQL or Clerk keys. It supports local enquiries, bookings, callbacks, merges, chat, sales and settings. Those writes are real changes to local development files, not production data. It never charges cards or sends provider email.

**Full application development** runs the production API against an explicitly selected development PostgreSQL database and configured development Clerk account, with Vite as the browser server. It needs environment setup and migrations appropriate to that database.

### Requirements

Use Node 24 or the supported Node 25 range and pnpm 11.19.0. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:preview
```

Open `http://127.0.0.1:4175/` on the Mac.

### Make it available to iPad/phone

From `artifacts/luxxy-motors`:

```sh
LUXXY_PREVIEW_LAN_HOST=192.168.1.114 PORT=4175 BASE_PATH=/ \
  pnpm exec vite --config vite.preview.config.ts --host 0.0.0.0 --port 4175
```

Replace that example IP with the Mac's current private network address. Connect the devices to the same reachable network and open `http://YOUR_MAC_IP:4175/`. Use the exact configured address; a different private address is not automatically authorized for the development API.

Binding to `0.0.0.0` lets the server receive LAN traffic. `LUXXY_PREVIEW_LAN_HOST` authorizes the local service for that host. Both are needed. The Mac must remain awake and the process running. Firewall rules and Wi-Fi client isolation can prevent access.

`localhost` and `127.0.0.1` on an iPad refer to the iPad, not the Mac. DHCP, a different router or hotspot can change the Mac's address. Local HTTP is not the same as production HTTPS; some browser APIs behave differently.

### Full development services

Configure a private root `.env` from the example, using development accounts and database only. Build the API before starting it:

```sh
pnpm --filter @workspace/api-server run build
pnpm dev:api
```

In another terminal:

```sh
PORT=4175 BASE_PATH=/ pnpm --filter @workspace/luxxy-motors run dev
```

Vite proxies `/api` and `/share` to `http://127.0.0.1:8080` by default; `API_PROXY_TARGET` can change that. `dev:api` runs the existing built bundle and is not a watch/rebuild command. Rebuild after API edits.

Local shared stores are under ignored `.local/`, including sale files, reservations/bookings, chat, staff operations and private development settings. Saved cars, browse position and unsaved editor drafts instead live in browser storage. Do not copy local customer/development files into a new dealer template or production environment.

## 22. Configuration and secrets

Use [.env.example](.env.example) for names and defaults, but note that some comments predate current Stripe support. Never commit an actual `.env` or expose private values through browser variables.

| Group | Key configuration |
| --- | --- |
| Server | `PORT`, `BASE_PATH`, `PUBLIC_SITE_URL`, optional `PUBLIC_SITE_BASE_PATH` |
| Database | `DATABASE_URL` |
| Customer capability links | Stable private `SESSION_SECRET` |
| Clerk | Backend secret/publishable keys and frontend `VITE_CLERK_PUBLISHABLE_KEY` for the same app |
| Staff bootstrap | `PORTAL_STAFF_EMAILS`; optional private server-integration `PORTAL_API_TOKEN` |
| Stock | `STOCK_DEALER_ID`, `STOCK_RETAILER_ID`, `STOCK_IMPORT_SECRET` and documented safeguards |
| Email provisioning | `RESEND_ENABLED`, `RESEND_API_KEY`, sender/reply-to and dealer notification destination |
| Private integration storage | `INTEGRATIONS_ENCRYPTION_KEY`, `INTEGRATIONS_PRIVATE_DIR` |
| Development reservation simulation | `RESERVATION_PAYMENT_MODE`; not the Stripe settings switch |
| Hours/stock monitoring | `DEALER_TIMEZONE`, `STOCK_STALE_AFTER_HOURS` |
| Server PDF images | Optional exact `VEHICLE_PDF_IMAGE_HOSTS` allowlist |
| Local network | Development-only `LUXXY_PREVIEW_LAN_HOST` |

`VITE_*` values are embedded into the browser bundle at build time. They must only contain public values. Rebuild when they change. Backend secrets are read at runtime. Deployment environment values take precedence over a local `.env`.

Private Resend/Stripe settings saved by the owner take precedence over the relevant environment provisioning fallback. Changing Stripe mode clears old mode keys and disables checkout until valid new configuration exists.

Keep `SESSION_SECRET` stable when intentionally migrating existing data so relevant customer links remain valid. Keep the private integration encryption key stable and backed up separately from the encrypted file; replacing it without a migration makes old private settings unreadable.

## 23. Deployment and copying the template

### Current model

Each dealership should have its own deployment, database, domain, branding, stock credentials, Clerk configuration and provider credentials. Dealer IDs scope application operations, but do not turn the current service into a complete multi-tenant hosting product.

The application can run on a Node host with PostgreSQL, including the Render approach discussed. It does not need Replit. Hosting infrastructure/domain provisioning are separate from code preparation.

### Build and serve

From the repository root:

```sh
pnpm install --frozen-lockfile
PORT=4175 BASE_PATH=/ pnpm build
pnpm start
```

The explicit build variables also satisfy the auxiliary workspace build configuration. At runtime the host may supply its own `PORT`; the default is 8080. Root `start` sets production mode and serves `artifacts/luxxy-motors/dist/public` through the Express service.

Set the production `PUBLIC_SITE_URL` to its HTTPS origin, configure Clerk for that domain and terminate HTTPS through the host. `/api/healthz` is suitable for liveness but does not prove database or provider readiness.

A persistent private directory is required for saved encrypted integrations. On a host using ephemeral service filesystems, mount persistent storage for it. The current private file store supports one API process; adding replicas requires a shared transactional replacement.

### Copying a new dealership

1. Create a new repository from the clean template/source, preserving a known release version.
2. Exclude `.env`, `.private`, `.local`, logs, customer data and local build/test outputs.
3. Provision a separate PostgreSQL database and hosting service.
4. Set a unique dealer ID, expected retailer ID and stock import secret.
5. Set independently owned Clerk keys, allowed domains and intended staff bootstrap access.
6. Generate new secret material for the new deployment and persistent encrypted settings store.
7. Review and apply migrations to that explicitly selected database.
8. Complete the guided website setup with genuine dealership text/photos/hours/reviews/legal details.
9. Configure Resend sender and Stripe account/webhook only if those services are wanted.
10. Import validated complete stock into staging and verify stock/booking/sale/document flows.
11. Connect the domain, verify HTTPS and integration acceptance, then agree the production launch.
12. Record the deployed version, backup arrangements and per-dealer configuration privately.

Avoid maintaining unrelated code forks for every colour/text change: prefer settings and common code updates. Separate copies still need a planned upgrade path; changing the master repository does not automatically update every deployed dealer.

### Database migration rules

Installation, build, startup and the post-merge hook do not apply migrations. Reviewed migrations are applied manually to a chosen database:

```sh
# Only after choosing and reviewing the intended target database.
DATABASE_URL="$TARGET_DATABASE_URL" pnpm --filter @workspace/db run migrate
```

For a historical database created by schema pushes, first restore a backup into an isolated copy and reconcile schema/journal history. Do not blindly apply a full old journal, drop existing objects or use schema push as a substitute for tracked migrations.

The committed journal extends through `0020_enquiry_merges`. Important recent changes include shared sales (`0016`), roles/settings history (`0017`), chat (`0018`), conversations (`0019`) and enquiry merges (`0020`). Confirm the target's actual applied history before rollout.

Starting the real API is not a read-only check: startup starts notification/recovery workers and attempts a legacy enquiry-to-lead backfill. Never aim a new staging process at an existing production database merely to see whether it boots.

Reference: [deployment.md](docs/deployment.md) and [MIGRATIONS.md](lib/db/MIGRATIONS.md). Older deployment statements that Stripe is absent are superseded by the integration implementation.

## 24. Security, spam protection and privacy

### Implemented controls

- Clerk identity plus database-backed staff roles and operation-specific permissions.
- Dealer-scoped production queries and protected staff/private endpoints.
- Revision checks for concurrent staff/settings changes.
- Transactions and locks around critical appointment, inventory and financial state.
- Capability token hashes, expiry/revocation and restricted customer responses.
- Required valid-format chat identity/contact fields; name and phone/email are mandatory before starting.
- Retry/idempotency handling in critical reservation, payment, chat and document flows.
- Signed Stripe events; browser redirects cannot assert payment success.
- Immutable issued documents and retained original payment/history entries.
- Private credentials kept outside public settings/browser storage and encrypted in production.
- Text escaping and input bounds; safe internal chat-action links.
- Separate in-memory rate counters for certain chat, appointment-change, contact-intent and payment routes.
- Server PDF image host/protocol/DNS checks and fetch byte/time/dimension limits.

### Limits identified in the spam discussion

Public enquiry creation, including new appointment/callback intake, currently lacks a shared persistent cross-route rate limit, a verification challenge, contact-ownership verification and persistent offender blocking. Mandatory contact fields validate format; they do not prove that a person owns a phone or email.

Existing in-memory counters reset on server restart and do not form one abuse budget across endpoints or replicas. Pending appointment approvals currently hold capacity without automatic expiry. These are areas to improve before broad commercial rollout.

Global CORS currently reflects request origins with credentials. Narrower private settings/sale checks exist, but there is no uniform global origin/CSRF policy. Hosting must verify client-IP handling behind its reverse proxy before relying on IP-based abuse controls.

### Proposed hardening — not implemented by this guide

Use a shared durable abuse budget, duplicate/retry suppression for public intake, server-validated bot challenge when appropriate, proportionate email/phone verification for slot booking, expiry/review for unconfirmed holds, and a staff spam/quarantine workflow. Repeat-offender restrictions should record reasons, expire/review appropriately and avoid permanently blocking every customer sharing a household/business/network.

Do not describe these proposals as existing functionality. Combining records organizes genuine duplicate interest; it is not automatically a spam decision or customer block.

### Privacy and truthful presentation

Named history comes from recorded enquiries/chat/reservations/sales, not anonymous browsing guesses. Reviews and badges rely on supplied evidence/metadata. Vehicle facts and availability should come from actual data. Random “people are viewing” or “saved X times” figures are not a verified analytics feature and should not be treated as genuine customer activity.

No legal/privacy compliance certification is established by this guide. The dealer's published policies, retention/access procedures and operational responsibilities need appropriate completion and review for its actual business.

## 25. Testing, backups and maintenance

### Type checking and builds

```sh
pnpm run typecheck
PORT=4175 BASE_PATH=/ pnpm build
```

Focused commands:

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/luxxy-motors run typecheck
pnpm --filter @workspace/api-server run typecheck
```

### Frontend tests

On Node 25, disable experimental Node web storage so jsdom supplies the expected storage implementation:

```sh
NODE_OPTIONS=--no-experimental-webstorage \
  pnpm --filter @workspace/luxxy-motors run test
```

### Browser tests

Playwright uses installed Chromium or an explicitly selected executable. For this Mac:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
LUXXY_LOCAL_PREVIEW=1 \
  pnpm --filter @workspace/luxxy-motors run test:mobile-layout --workers=2
```

Journeys cover stock, vehicle pages, mobile/tablet layouts, booking, chat, settings, sales, documents, histories and merges. Write-oriented browser checks should intercept synthetic API records and block unexpected real writes. Browser emulation is useful but does not replace physical iPhone/iPad/Safari acceptance.

### Backend tests

Focused scripts include `test:bookings`, `test:enquiry-merges`, `test:callback-conversations`, `test:sale-workspace`, `test:relationships`, `test:chat`, `test:dealer-improvements`, `test:settings`, `test:brochure` and `test:safety`.

Some suites use pure rules, fake database drivers or temporary file stores. Others require an isolated PostgreSQL database. The full API test command must not be run against real dealership data.

Database integration suites require `LUXXY_TEST_DATABASE_URL`: a loopback PostgreSQL address, a database name starting `luxxy_test_`, and the required guarded format. They can truncate/delete fixture data. They do not fall back to inherited production `DATABASE_URL`. Use disposable databases and check each suite's requirements.

Backend test scripts rebuild the same `dist-test` directory, so run them sequentially rather than launching package scripts against that directory at the same time. Socket-based tests may need an environment permitting loopback test servers.

The migration test is separate. Its current assertion still targets the earlier `0016` snapshot/latest tag and needs updating for the journal through `0020` before a current migration verification run can be called passing. No production migration acceptance is implied by the unit/browser checks.

### Checks completed for the latest merge work

- Shared-library, frontend and API type checks passed.
- Frontend and API production builds passed.
- Nine backend/temporary-store merge tests passed.
- Seventeen focused frontend/grouping tests passed.
- Seventeen relationship aggregation/preview-access tests passed.
- Eight isolated responsive browser merge checks passed.
- The LAN server returned successful responses for home, stock and stock API after restart.

These are scoped results, not a claim that every historical test or a live-provider end-to-end suite was rerun on 5 October. Existing build advisories include a large frontend chunk and UI-component sourcemap diagnostics; they did not fail the builds.

### Backups

Back up the production PostgreSQL database, the encrypted private integration file, separately protected encryption material, stable link/session secret and dealership deployment configuration. Preserve issued documents and numbering history. If using hosted media, record who owns it and how it is backed up.

Test restoration into an isolated environment; a backup that has never been restored is not proven recovery. Restore the matching secrets with existing data where continuity of encrypted configuration/customer links is intended. Do not copy one dealer's customer data into another dealer's deployment.

### Regular maintenance

Review unanswered enquiries, callbacks, pending appointments, delivery work, failed emails, uncertain payment/hold states, suspicious import prices and stale stock. Reconcile financial events rather than rewriting old receipts. Monitor logs without exposing secret tokens. Keep common code/dependencies updated and release changes through staging before updating dealer copies.

## 26. Troubleshooting

| Symptom | Check |
| --- | --- |
| iPad/phone cannot reach the site | Current Mac IP, running process, same reachable network, firewall/client isolation and correct port |
| HTML loads on LAN but stock does not | Exact `LUXXY_PREVIEW_LAN_HOST`, authorized host/origin and API response; binding alone is insufficient |
| Port 4175 is in use | Identify the existing process before starting another; avoid running multiple servers over the same local stores |
| Changes appear missing | Correct server/run mode, rebuilt API bundle, browser refresh/cache, current route and whether settings were actually published |
| Full development stock API fails | API process on the proxy target, selected database, migrations, dealer ID and successful import |
| Test-drive slots are missing | Selected available car, booking enabled, notice/window/hours/blocked dates, capacity and pending approvals |
| Customer cannot reserve | Reservation switch, availability, terms/deposit and actual payment readiness; production rejects simulation/test mode |
| Callback has no due time | Stored showroom hours cannot determine a valid next opening; staff must schedule it |
| Merge/save returns 409 | Another revision changed; refresh/review rather than automatically overwrite |
| Enquiry closure leaves calendar occupied | Cancel the appointment explicitly; closing status is not appointment cancellation |
| Email is prepared/failed | Provider enabled, verified sender, valid destination, key/configuration and saved delivery error/status |
| Stripe returned but payment is pending | Verify signed webhook delivery/reconciliation; browser return is not proof of payment |
| Private integration file cannot decrypt | Matching original encryption key and encrypted backup; do not generate a replacement key over existing data |
| Print does not open | Image preparation/error message, one-page fit and browser print permissions/settings |
| Gallery images vanish | Source URL/CDN failure; failed images are intentionally removed rather than displayed as broken tiles |
| Unit tests fail on localStorage in Node 25 | Set `NODE_OPTIONS=--no-experimental-webstorage` |
| Staff can sign in but not access a section | Dealer role/active status, allowlist/bootstrap and API permission |
| Local records appear different between devices | Same server/store versus browser-local saved cars/drafts; different origins have separate browser storage |

Do not “fix” a stock outage by importing an empty successful snapshot, or “fix” a payment timeout by declaring the deposit paid. Investigate the actual state.

## 27. Known limits and next development priorities

The following are limits/proposals, not features completed by writing this guide:

1. **Production commissioning:** Verify target migrations, database restoration, real staff identity and provider/domain setup in isolated staging.
2. **Abuse protection:** Add durable cross-route controls, booking-intake duplicate handling, proportionate verification and staff spam review.
3. **API documentation coverage:** Bring newer custom-fetch APIs and retired contracts into one accurate, current specification.
4. **Migration test maintenance:** Update the older migration-verification assertions to the current schema/journal.
5. **Template rollout tooling:** Automate provisioning/configuration/version tracking for separate dealer deployments. No self-service provisioning exists yet.
6. **Scaling private settings:** Replace the single-process encrypted file store before introducing multiple API replicas for one dealer.
7. **Media management:** Add secure upload/storage if a direct photo library or customer part-exchange uploads are desired.
8. **Portal web app:** The portal is responsive, but an installable PWA/offline synchronization/push-notification system is not established by this implementation.
9. **Measured performance:** Reduce remaining large route/shared bundles and measure real-device loading; local build success is not a field-performance score.
10. **Genuine analytics:** Configure actual analytics if wanted. Optional tracking calls are not proof that an analytics service is provisioned; synthetic demand counts must not be presented as measured interest.
11. **Document edge cases:** Maintain the truthful one-page print boundary for unusually large source descriptions/equipment lists rather than silently clipping them.
12. **Customer operational policy:** Complete dealership-specific privacy, reservation, warranty, delivery, retention and financial-document procedures.

A multi-tenant platform is possible as a separate architecture project, but would need tenant resolution, isolation, configuration ownership, credentials, migrations, billing/provisioning and operational controls beyond the current separate-deployment template.

## 28. Detailed reference documents and glossary

### References

| Reference | What to use it for |
| --- | --- |
| [Dealership onboarding](docs/dealership-onboarding.md) | Website setup controls and editable content boundaries |
| [Dealer operations](docs/dealer-operations.md) | Staff roles, callbacks, settings history, stock health and export |
| [Customer chat](docs/customer-chat.md) | Chat identity, automatic answers, staff workflow and storage |
| [Enquiry merges](docs/enquiry-merges.md) | Complete merge API and preservation/concurrency rules |
| [Vehicle/customer history](docs/vehicle-customer-history.md) | Matching, timeline aggregation and source links |
| [Sales lifecycle](docs/sales-lifecycle.md) | Ledger, documents, provider bridge and handover |
| [Email/payment integrations](docs/integrations-email-payments.md) | Resend/Stripe configuration and reconciliation |
| [Online reservations](docs/online-reservations.md) | Reservation policy and distinction from received money |
| [Grok handoff](docs/integrations/grok-stock-handoff.md) | Stock import payload/delivery contract |
| [Grok example](docs/integrations/grok-stock-example.json) | Full schema-version-1 sample envelope |
| [Independent deployment](docs/deployment.md) | Runtime, domain/auth setup and single-service serving |
| [Migration guidance](lib/db/MIGRATIONS.md) | Manual deployment migrations and isolated test safety |
| [OpenAPI](lib/api-spec/openapi.yaml) | Generated-client contract; supplement with newer route modules |

Dated redesign, PDF and regression documents are historical evidence. For example, the old vehicle PDF guide describes a multi-page download; the current customer print implementation is the one-page component described above. Use source review and document dates when resolving contradictions.

### Glossary

| Term | Meaning here |
| --- | --- |
| Advert ID | Stable source listing identifier used for stock updates |
| Vehicle UUID | Website/database identifier used in vehicle routes and relationships |
| VRM | Actual vehicle registration mark/number plate; different from year/band |
| Complete snapshot | Every currently listed car for one retailer in one import |
| Quarantine | Unsafe/suspicious import held for investigation without replacing good stock |
| Enquiry | Recorded customer interest, question, call, callback or booking context |
| Combined case | Main enquiry with explicitly linked, preserved originals |
| Revision | Version number used to reject stale changes |
| Idempotency | Safe retry that does not apply the same payment/request twice |
| Capability link | Private random-token URL granting narrowly defined customer access |
| Received payment | Explicitly confirmed manual funds or verified real provider funds |
| Pending payment | Expected money that does not reduce the confirmed balance |
| Invoice | Issued agreement/charge document; not itself evidence of received money |
| Receipt | Issued record of an individual confirmed payment/refund with its saved financial context |
| Handover | Actual collection/delivery completion, separate from payment settlement |
| Publication | Revision-checked owner change to public website settings |
| LAN development mode | Local running UI and file-backed services for review; never the production deployment |

**Maintenance note:** Update this guide when routes, storage, provider behavior, migration requirements or the template model change. Keep production runbooks and secrets in the operator's private systems rather than adding credentials or customer data to this repository.
