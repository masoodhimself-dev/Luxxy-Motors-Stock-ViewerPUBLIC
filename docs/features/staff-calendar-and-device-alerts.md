# Staff calendar and device alerts

## Staff experience

Open **Notifications → Test drives → Calendar**. Desktop starts on Week; narrow screens start on Day. Day, Week and Month remain available on every screen. Today and previous/next controls change the displayed period. Date arithmetic and appointment times use Europe/London, including BST/GMT changes.

Cards identify the appointment time, customer, vehicle, supplied registration, assigned staff and status. Vehicle photographs come from current stock; unavailable images have a neutral fallback. Tapping a card opens an accessible detail sheet. Customer/attendance, vehicle information and appointment changes use the existing protected workflows. Merely opening a card cannot change the booking. The calendar retains cancellation, pending approval, attendance and booking-exception labels.

Filters provide customer/car/plate/reference search, booking status, staff ownership and cancelled records. They start collapsed. Add appointment carries the selected date into the existing staff booking form; saving still uses the original availability, capacity, revision and override checks.

**Device alerts** is a small expandable control in Notifications. Staff can enable this device, send a test, choose categories and reminder timing, or disconnect this and other enrolled devices. Preferences apply to that person's devices within the current dealership. There are no permission prompts on page load.

## Delivery and access

The authenticated API stores subscriptions against a dealership, staff account and verified website origin. An existing endpoint cannot silently be transferred to another staff account or dealership. Mutations require the matching website Origin. Settings responses never contain stored endpoint URLs or encryption keys. Current staff membership and permission are rechecked at delivery; email failure alerts require sales permission.

The supported categories are new enquiries, test-drive requests/changes/cancellations, confirmed appointment reminders, due follow-ups and recorded email failures. Event scanning starts after device enrolment and avoids a flood of old enquiries. Defaults use a 30-minute appointment reminder. Rescheduled/cancelled/completed appointments and completed follow-ups invalidate stale reminder jobs.

Migration **0038_staff_push** adds preferences, device subscriptions and a durable deduplicated delivery queue. The API process starts its queue check when explicitly configured, and repeats every minute. Failed transient deliveries have bounded retries; expired browser endpoints are removed. Queue claims support multiple application processes and restart recovery. Normal demo tenants do not receive automated background alerts; an explicitly requested device test is still available.

Push acceptance is not a delivery/read receipt. Operating system settings, Focus, network access, browser policy and expired subscriptions can affect delivery. The portal work list remains the authoritative place to find outstanding work. Dismissing an operating system notification never completes a task.

Notifications show generic text. Customer identity, messages, telephone numbers and number plates stay inside the signed-in portal. A notification opens a same-origin portal link. The service worker has no fetch/cache handler and does not cache private customer pages or API responses. Account changes/sign-out unsubscribe the local endpoint and clear displayed notifications where the browser permits it.

## Deployment and device setup

1. Apply the normal ordered database migrations, including 0037 and 0038, against the intended isolated environment. Do not use a production database for tests.
2. Generate a persistent VAPID key pair in the operator's secure environment. Configure server-only `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT` (a real `mailto:` operator contact or HTTPS contact URL). Keep the private key out of chat, logs, source control and all `VITE_*` variables. The public key is supplied by the authenticated settings endpoint.
3. Set `WEB_PUSH_ENABLED=true` only after the migration and configuration are ready. Deploy/restart the API and frontend together. Missing/invalid configuration disables sending cleanly.
4. Verify the actual HTTPS dealership origin. `/portal-push-worker.js` must return JavaScript and `/portal.webmanifest` must return its manifest; neither may fall through to SPA HTML. They use no-cache headers. A private-network HTTP phone preview is insufficient for mobile push.
5. Sign in as an authorised staff member, expand Device alerts and enable this device. Accept the browser/OS prompt, then send one test. The local file-backed preview deliberately reports unconfigured and cannot enrol or send.
6. On iPhone/iPad (iOS/iPadOS 16.4+), add the portal to the Home Screen first and open that installed web app. Then enable notifications from its own button. On Android, use a current supported browser; installation is optional where the browser supports push without it.
7. Check one fictional enquiry and booking, a changed/cancelled booking, a reminder, and an opt-out. Test background/locked-device delivery on actual Apple and Android hardware. Browser viewport emulation does not establish mobile push delivery.

The manifest is attached only inside the authorised staff portal. Public car shoppers are not offered a staff app installation. Every separate dealership origin has its own browser permission and registration. Changing domains or rotating the VAPID key requires device re-enrolment. Existing email delivery and customer reminders are separate from staff device alerts.

Official platform references: [Apple Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [web-push server library](https://github.com/web-push-libs/web-push).

## Verification record

Automated checks use fictional records, mocked push transport and an isolated in-process test database. They must not contact real push providers or load deployed database credentials. Local UI inspection covers desktop, tablet and phone layouts. Deployment, OS permission and real-device delivery are separate commissioning checks and must not be reported as passed by unit tests alone.
