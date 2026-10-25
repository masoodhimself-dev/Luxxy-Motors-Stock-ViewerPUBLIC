# Price-reduction follow-ups — 25 October 2026

## Scope and release status

Implemented on `codex/price-drop-followups-2026-10-25`. Local implementation and testing only: no deployment, live migration, live stock import, customer message, invoice or payment change was performed.

The accepted scope was clearer customer contact choices, individual follow-up outcomes, durable current-price checks for saved messages, and configurable reminder thresholds. Existing price detection, public reduction evidence and manual sending rules remain in place.

## Staff workflow

- Home shows a genuine reduction and eligible interested customers. **Contact customer** offers Email, WhatsApp QR and Call; customers with only a phone number can use WhatsApp.
- Staff can record a phone conversation, mark contact unnecessary, or choose a future follow-up with a private note. Email provider acceptance and staff-confirmed WhatsApp messages also record contact. A draft or QR preview does not count as contact.
- Pending customers and scheduled follow-ups keep the task open. A separate enquiry reminder preserves a planned callback when the price task is superseded. Existing unrelated callbacks are protected.
- Counts cover all eligible customers, including more than the 100 displayed at once. Unfinished customers appear before completed rows, so older enquiries cannot become stranded behind the limit.
- **Settings → Emails & documents → Price updates** provides an owner-controlled minimum reduction and contact interval. Defaults are £100 and seven days; both can be zero. These affect staff suggestions, never automatic sending. All genuine price changes retain their existing history/public evidence. Booked visits, paid commitments and planned callbacks still receive review.

## Accuracy and customer protection

Saved price drafts carry their originating task ID and revision. Editing wording, reopening through the ordinary Inbox and using email fallback preserve that context. Replacing wording with a newer price requires an explicit staff action and a valid current context.

The server checks the current price, availability, dealership, customer eligibility and recipient for email preview, send, queued retries, sharing-pack creation/replay, phone preview and email fallback. An outdated message is refused without silently rewriting staff text. Reserved/unavailable vehicles cannot receive a price-update offer.

Price QR codes always open a checked phone preview rather than embedding a permanent `wa.me` message. The phone checks again immediately before opening WhatsApp, rejects changed content and recipient overrides, and drops responses from an earlier QR/customer. Staff still tap Send themselves. The desktop number is read-only for a contextual price message; correcting a customer's number requires updating the enquiry and preparing fresh wording.

Confirmed contact recording is idempotent and retains the original contact timestamp on retries. A late repair must not replace a newer staff decision or complete a callback created after that contact. Normalized UK/international phone matching protects customers with existing agreed sales or deposits.

Agreed prices, deposits, payment ledgers, issued invoices, appointment rules and stock import scheduling are not altered.

## Verification

| Check | Result |
| --- | --- |
| Full frontend suite | 196 files, 2,142 tests passed |
| Backend stock-change integration | 33 passed; includes tenant isolation, role checks, revisions, preferences, outcomes, 101-customer processing, phone-format eligibility and callback continuity |
| Local preview regression | 1 passed, included in `test:stock-changes` |
| Saved message / email / media / outbox regressions | 75 checks passed initially; the contextual integration suite subsequently passed all 8 cases against the final backend |
| Phone handoff | 32 tests passed, including stale content, expiry, hash changes, late responses and recipient formatting |
| Desktop QR | 24 tests passed; price QR uses checked preview and locks the recipient |
| Final Inbox regression | 21 tests passed after clearing the closed composer's stock/sale action parameters |
| Workspace typecheck and production build | Passed; existing large-chunk build warnings remain |
| Disposable database migration | Migrations through `0053` applied successfully in isolated tests |

The live browser was used against an opt-in local preview with three clearly fictional enquiries. Home, the contact/callback dialog, WhatsApp composition/QR, phone preview and Settings were checked at 390×844, 820×1180 and 1440×1000. Document widths matched their viewports without horizontal overflow. The native date control accepted a future date and saved the callback. Settings were saved, the minimum was raised from £100 to £600, the existing £500 callback remained visible, and defaults were restored.

For the phone-only fictional customer, the handoff showed `+447700900456`, the exact £3,250 → £2,750 wording, and an explicit current-price check. The local **I've sent it** confirmation updated that customer's mock outcome to WhatsApp-contacted; the other customers were not marked contacted. No real WhatsApp send or external email was performed.

Screenshots and viewport measurements are saved in the original workspace's `output/price-drop-followups-2026-10-25` folder. These are browser viewport checks, not physical iPhone/iPad tests. Temporary fictional local enquiries are removed after QA.

## Migration and limits

Apply `lib/db/drizzle/0053_stock_change_customer_outcomes.sql` before deploying this API. It adds private preferences, per-customer outcomes and idempotent contact events. It creates no historical messages and changes no existing financial records.

Historical drafts that never stored a price-task reference remain ordinary drafts: their purpose cannot reliably be inferred from edited prose. New contextual drafts are protected. Once a person has opened an external WhatsApp draft, Luxxy cannot retract its text; the app verifies freshness immediately before that handoff.

The complete API test pipeline was not run; the affected integration/regression groups were run. Production delivery, physical-device operation and the migration on Render remain unverified until an authorized release.

## Final release checks

The final HTTP context test creates a real fictional price reminder, confirms WhatsApp through the application route and verifies completion. It then retries an older confirmation after a newer callback is scheduled and verifies that the newer outcome/reminder remains intact and the original contact time is retained. All 8 contextual cases passed (`/tmp/price-context-final-lifecycle.log`).

The full frontend run passed before the final one-test Inbox regression was added; that complete 21-test workspace file passed afterwards. Frontend and API production builds passed after their final application changes. The workspace typecheck and diff check were repeated before committing. Existing build size warnings are unrelated to this feature.

Only the three named fictional local enquiries were removed, after checking their exact IDs and test notes; a recoverable backup remains at `/private/tmp/luxxy-price-test-enquiries-2026-10-25.backup.json`. Defaults are restored to £100/seven days. The local preview remains available at `http://127.0.0.1:4220/portal?section=settings&settingsTab=stock-updates`. No push is included in this task.
