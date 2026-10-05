# Website customer chat

The website has a quiet **Ask us** button. It opens only when selected and takes the car from the current vehicle page. Customers must leave their name and a valid email address or phone number before starting a chat. They can then ask questions or request a callback. They can return to their identified conversations on the same browser without entering those details again.

The greeting and replies use a friendly showroom tone. Automated replies are attributed to **Showroom assistant**; staff replies use the signed-in staff member's name. Direct identity questions receive an honest answer. There are no fake staff names, typing indicators, automatic pop-ups or fabricated online status.

## Staff workflow

Open **Portal → Chat** to search conversations, filter waiting/unread/open/resolved chats, read the transcript, assign staff, take over, reply or resolve. Unread notifications appear in the portal. The thread carries the car snapshot and the contact details shared by that customer.

Starting a chat creates one real enquiry and links it to the conversation, including when the customer has not sent a question yet. Contact details, the car snapshot and the transcript are saved together. Repeated requests update that enquiry rather than creating duplicates. Staff can open the enquiry, arrange an appointment using the existing diary, request follow-up there, and move between customer and vehicle History. History includes the identified conversation and an **Open conversation** link. Older anonymous conversations remain readable and available to staff; the customer must supply valid contact details before sending another message or requesting handover.

Staff choose **Go available** while they can respond. Availability requires both a recent staff heartbeat and published opening hours, interpreted in Europe/London. Outside hours, the widget offers a message/callback and the next opening time where it can be determined. The service does not promise immediate replies.

## Settings and automatic answers

Open **Portal → Settings → Website chat** to enable/disable chat, switch automatic answers on/off, customise the button, greeting and offline message, and control unread notifications. Chat inherits the website's colour palette. Settings publishing requires owner permission; staff can read chat preferences.

The first version answers common questions in code using current public stock and published dealership details. It covers price, mileage, fuel, transmission, equipment, opening hours and published warranty/delivery information. It refreshes the car data before answering further questions. Missing or uncertain facts, negotiations, valuations and private sale/payment questions are passed to staff. It does not use an external AI provider, disclose private purchase history, or create a booking/payment from an answer. Booking and eligible reservation links lead into the existing flows.

## Storage, security and deployment

- `POST /api/chat/conversations` accepts `{ requestId, vehicleId?, message?, name, email?, phone? }`. The name must contain 2–120 characters after trimming, and at least one valid contact method is required. Email addresses are trimmed, lowercased and limited to 254 characters. Phone input is limited to 30 characters; spaces, brackets, dots and hyphens are removed, then 7–15 digits with an optional leading `+` are required. Invalid supplied contact fields are rejected even when the other field is valid. The contact update endpoint uses the same checks and cannot remove all contact details. A callback requires a phone number.
- Public chat requests use a random bearer session token; only its hash is stored on the server. A token authorises one conversation and expires after 30 days. Knowing a conversation ID, email or request ID does not grant access.
- Messages/start requests use retry references so a lost network response does not duplicate them. A start retry with the same request ID and valid session token recovers the existing conversation and enquiry without replacing the saved identity. Customer sessions remain scoped to their browser origin and dealership.
- Staff requests use the existing staff authentication and permissions. Chat settings changes require `settings.publish`; chat writes require `sales.manage`.
- API responses are not cached. Tokens are redacted from logs, input lengths are limited, and public routes have rate limits. Message text renders as text; customer actions accept only safe internal links.
- Production persists chat state in PostgreSQL with a dealer-scoped transaction lock. Migration **0018_dealer_chat** is prepared with its journal and schema snapshot, and has not been applied to a live database. Apply it through the normal deployment procedure before enabling chat in production.
- The network preview uses a private atomic file and an outbox to recover the linked enquiry if the server stops between writes. Existing bookings and sales remain in their current stores.

## Verification

The frontend suite, isolated backend/preview chat tests, relationship tests and browser flows cover required contact, validation, atomic enquiry creation, legacy contact recovery, session privacy, retries, contact linking, handover, stock answers, settings, hours, responsive layouts and safe source links. Browser tests intercept synthetic API data and block unexpected writes; no live customers, emails or payments are used.

Commands: `pnpm --filter @workspace/api-server run test:chat`, `pnpm --filter @workspace/api-server run test:relationships`, and `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @workspace/luxxy-motors run test`. Browser coverage is in `tests/customer-chat.spec.ts`.
