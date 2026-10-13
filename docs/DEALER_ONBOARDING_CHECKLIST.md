# Dealer onboarding checklist

Checked against the shared-platform implementation on 13 October 2026. Copy this checklist for each dealership. Tick a test only after observing its result; entering a setting is not proof that it works.

The platform shares its application and database between dealers, with dealer-scoped records, domains, staff and credentials. Adding a dealer does not require a new Render account, service, database or code copy. Historical separate-deployment recommendations in `dealership-onboarding.md` and `dealership-onboarding-blueprint.md` do not describe this current architecture.

## Onboarding record

| Item | Value |
| --- | --- |
| Dealership trading / legal name | |
| Internal dealer ID — fixed after creation | |
| Canonical HTTPS website / aliases | |
| Owner account email / Clerk user ID | |
| Marketplace — Auto Trader OR Cazoo | |
| Exact source retailer reference | |
| Authorised stock source URL | |
| Stock import endpoint | |
| Bot name / secure secret variable name — never its value | |
| Morning / evening schedule, Europe/London | |
| Sender address / working reply-to mailbox | |
| Monthly price / billing arrangement / start date | |
| Operator, dealer approver and launch date | |

## 0. Platform checks — once, then maintain

- [ ] Shared Render application and database are healthy; the intended release and migrations are deployed.
- [ ] Platform administration works on its approved host; access is restricted to authorised administrators.
- [ ] Clerk sign-in works on the intended dealer domains. Confirm production authentication readiness before a paying public launch; staging access alone is insufficient.
- [ ] Tenant-isolation checks pass for stock, customers, appointments, sales, private photos, emails and credentials.
- [ ] Confirm the database recovery window, backup coverage and restore procedure. Complete an isolated restore test; an independent scheduled backup has not been commissioned merely by creating dealers.
- [ ] Assign responsibility for failed imports, email failures, outages and customer support.
- [ ] Confirm how subscriptions will actually be collected. Platform subscription tiers / automatic dealer billing are not yet configured; record a manual or separately established billing arrangement.

## 1. Collect the dealer's information

- [ ] Agree the price, services included, billing date and support contact.
- [ ] Obtain the correct business identity, contact details, address, opening hours and visiting instructions.
- [ ] Obtain permission to connect the stock source, and confirm the exact retailer reference and source URL.
- [ ] Choose one marketplace for this dealer: Auto Trader or Cazoo.
- [ ] Obtain the domain and access needed for DNS changes.
- [ ] Obtain approved logos, website images, service information, genuine review links and policy wording.
- [ ] Confirm the owner has an existing Clerk account. Email-based lookup currently requires an existing account; the creation form does not send a new-account invitation.

## 2. Create the draft dealership — you

- [ ] Open **Platform administration → Add dealership**.
- [ ] Complete business → HTTPS website → owner → marketplace/source → review.
- [ ] Check the generated internal ID before creation; use a unique permanent ID.
- [ ] Assign the actual owner. Select your own account only if you should be this dealer's owner; platform administrator access does not automatically grant dealer-staff access.
- [ ] Create the draft. Confirm its name, domain, owner, marketplace and retailer reference.
- [ ] Record the dealer's generated domain-verification TXT record.

## 3. Connect the domain — you / domain owner

- [ ] Add the canonical domain to the existing shared Render web service.
- [ ] Add the DNS records Render supplies. The current shared target is `luxxy-shared-staging.onrender.com`; recheck the target if hosting changes. Preserve existing mail records.
- [ ] Add the application's TXT record exactly as generated: `_dealer-verification.<hostname>` with this dealer's own `dealer-verification=...` value. Do not copy another dealer's token.
- [ ] Verify ownership in the platform dashboard.
- [ ] Separately verify the custom domain in Render and confirm HTTPS works without a certificate warning.
- [ ] Register and verify any alias, such as `www`, in both systems; confirm the intended website address works.
- [ ] Activate the dealership for controlled testing. The backend requires an active dealer for stock imports. Activation is not final launch approval.

## 4. Configure the dealer portal — owner / authorised staff

- [ ] Sign in on this dealer's domain; confirm the correct workspace and staff permissions.
- [ ] Set logo, colours, photography and page wording; remove inherited, sample or inaccurate content.
- [ ] Set telephone, WhatsApp, email, address, map and opening hours.
- [ ] Configure actual booking rules and closed dates; confirm they agree with the published hours.
- [ ] Enable only services the dealer offers. Leave optional reservations/payments disabled until their setup is tested.
- [ ] Supply approved business details, privacy information, sale/reservation terms and invoice settings, including reference sequence and applicable company/VAT information.
- [ ] Review and publish settings; check mobile and desktop readability.

## 5. Connect stock — you + the dealer's Grok bot

- [ ] Create a dedicated import credential in this dealer's stock connection. Confirm an active credential exists.
- [ ] Save the one-time secret directly into the dealer bot's masked secure input. Never paste it into chat, files, URLs or logs.
- [ ] Give the bot the exact approved HTTPS host and `/api/stock/imports/DEALER_ID/grok` endpoint. Current import origin: `https://luxxy-shared-staging.onrender.com`.
- [ ] Have Master Bot prepare a separate dealer bot/config/cache; the new bot handles its own secret card and routine. Keep scheduled delivery off initially.
- [ ] Verify a real authorised collection for the selected marketplace. A working Auto Trader collector does not prove the Cazoo collector works.
- [ ] Validate one fresh, complete schemaVersion 1 snapshot: exact retailer reference, stable advert IDs, matching source platform, counts, prices and available images. Missing facts stay missing; OCR plates retain their provenance.
- [ ] Approve one controlled authenticated POST. Confirm HTTP 201 `imported` and inspect platform Import activity.
- [ ] Resend identical bytes and run ID. Confirm HTTP 200 `replayed` and no duplicate effects.
- [ ] Check the exact car count, prices and photographs on this dealer's site and portal; check the other test dealer has not changed.
- [ ] Verify rejection of wrong credentials/dealer identity and incomplete collection, using isolated tests. Never deliberately submit damaging test snapshots to a live dealer.
- [ ] Confirm missing adverts are not labelled sold, and dealer-controlled sold/reserved states and plate corrections survive imports.
- [ ] Approve twice-daily delivery. Use Europe/London, every day, with staggered dealer slots and BST handling; the platform dashboard does not configure bot schedules.
- [ ] Observe the first actual morning and evening deliveries. Record their run IDs and verify failure alerts reach the operator.

## 6. Configure outgoing email — owner / you

- [ ] Verify the dealer's sending domain in Resend and save its own API key privately in portal settings.
- [ ] Set a correct sender and a working reply-to mailbox. Sending-domain verification does not create an inbox.
- [ ] Review the dealer's customisable email templates and contact details.
- [ ] Send a controlled email to your own test address from **Email**, linked to a test enquiry/car.
- [ ] Test service-book/pre-accident attachments and an invoice attachment; confirm the recipient receives the correct dealer's files.
- [ ] Check delivery status. The key must permit email retrieval for this feature; sending-only access may not suffice.
- [ ] Explain that **Opened** depends on provider tracking and is not proof the customer read the email. Incoming replies are not yet integrated into the portal.

## 7. Test the staff and customer workflows

Use clearly identified test records and a designated test vehicle. Do not mark genuine stock sold merely to tick this list.

- [ ] Homepage, search, vehicle, contact and saved-car pages show the correct dealer on desktop and phone.
- [ ] Missing descriptions, plates and photographs do not produce misleading information or broken layouts.
- [ ] Submit a test customer enquiry; confirm it appears in this dealer's workspace and history.
- [ ] Book through the website and through staff; confirm both appear in the calendar. Check rescheduling, follow-up, double-book warning and staff out-of-hours marking.
- [ ] Log a call without booking, select stock or an ad hoc vehicle, and locate the customer's history.
- [ ] Upload a service-book photo through the phone QR flow; check compression, access and attachment selection.
- [ ] Create a test sale: car → customer → adjustments/payments → deposit/full invoice → review.
- [ ] Check fees, discounts, part exchange and multiple dated payments against a manual calculation.
- [ ] Confirm a deposit reserves the test vehicle; check the approved unreserve flow.
- [ ] Inspect printed/downloaded invoices for branding, vehicle details/photo, references, totals and payment history.
- [ ] Confirm a full invoice does not automatically mark a car sold; the explicit sold action removes it from public stock.
- [ ] If online payments are offered, separately configure and test that dealer's Stripe integration before enabling it. This does not configure your platform subscription billing.
- [ ] Remove or clearly retain test records as appropriate; restore the designated test vehicle's intended availability.

## 8. Launch and hand over

- [ ] Dealer approves their business details, stock, enabled services and paperwork.
- [ ] Give staff the website/portal links and a short walkthrough: enquiries, appointments, All cars, sales/invoices and Email.
- [ ] Confirm who can edit settings, manage staff and contact support.
- [ ] Record billing arrangements, launch approval and all tested results; keep secrets out of the onboarding record.
- [ ] Confirm monitoring and failure alerts. Review the first few days of stock imports and customer activity.
- [ ] Confirm retention responsibilities: cars archive after seven eligible days; original invoices and payment records remain protected. No automatic financial-record purge should be promised.
- [ ] Publicly launch only after required checks pass. Optional unchecked features stay disabled.

## Final sign-off

| Area | Result / evidence | Approved by / date |
| --- | --- | --- |
| Domain ownership + Render HTTPS | | |
| Owner / staff sign-in | | |
| Correct business settings | | |
| Stock import + identical retry + isolation | | |
| Morning + evening scheduled deliveries | | |
| Email send + attachments + status | | |
| Enquiries + appointments | | |
| Invoice calculations + availability | | |
| Backup / recovery readiness | | |
| Billing + dealer approval | | |

**Ready** means tested and approved. **Configured** means entered but not yet proven. **Optional / disabled** means intentionally excluded. Keep those states separate.
