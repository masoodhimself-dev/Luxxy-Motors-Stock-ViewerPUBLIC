# Shore Drive customer reply release — 23 October 2026

## Released

- Branch: `codex/customer-email-replies`.
- Reply routing commit: `c3bc3e14af62ae0e403df0853fc14e8c68ef43a2`, Render deploy `dep-dbdji6uq1p3s738rducg`, live.
- Scoped notification and task-preview commit: `79318c2fad4346c0321334f9335f80e141fbe074`, Render deploy `dep-dbdjotoae00c738ejung`, live.
- Migration `0052_customer_email_replies.sql` applied successfully by Render pre-deploy.
- Final Shore Drive `/api/readyz` returned `{"status":"ready"}`.
- Only Shore Drive is enabled for reply routing and device notifications. Marketplace email importing remains paused. No stock import credentials, worker delivery flags or schedules were changed.

## Live test

Reused the dedicated test enquiry `5fdf623f-1f45-43e5-a9a2-81c275e0d596`, named “TEST — Portal email 23 Oct”. It is separate from Masood's existing unsent customer draft, which was left untouched. No booking, vehicle update, sale, deposit, invoice or follow-up was created.

1. Sent “TEST ONLY — Shore Drive reply routing” through the actual portal from `sales@shoredrive.uk` to Masood's approved test address. Gmail received message `1a1685d5be7e4944`.
2. Verified a unique Reply-To on the existing Resend-managed receiving domain. The private reply capability is intentionally omitted from this report.
3. Sent a fictional customer reply from that Gmail account. Message `1a1685e28e32be59` appeared once in the exact Shore Drive enquiry and its conversation history. Home showed the reply task; opening it did not resolve it.
4. Used the live “Mark handled” button. The message remained in history with Handled status, and its Home task cleared.
5. Sent a second fictional reply, message `1a16862781723c39`. The same enquiry again showed Reply needed, including after it was opened.
6. Prepared a staff acknowledgement. The recipient was automatically populated in the reviewed email. Sent it through the portal, without attachments or business actions.
7. Gmail received acknowledgement `1a16867e3fa9fd0d` in the original Gmail thread. Its In-Reply-To exactly referenced the second customer's Message-ID. All four messages belong to Gmail thread `1a1685d5be7e4944`.
8. The second reply became Handled automatically and the dedicated test enquiry disappeared from Home's reply tasks. Both received emails remain in the portal alongside the two new outgoing emails and the earlier unrelated portal test email: five email records total, with no duplicate inbound records.

## Validation

- 12 reply integration checks, including signed webhook persistence, invalid/stale/tampered signatures, duplicate handling, tenant boundaries, same email/different cars, ignored marketplace mail, mismatched sender, DMARC failure, HTML conversion, attachment metadata, provider outages, bounded lease recovery, merged cases, immutable sends, newer reply preservation, Home actions, cross-origin rejection and notification deduplication.
- Existing email recovery: 20 checks.
- Existing email workspace and explicit-case scoping: 1 + 8 checks.
- Push suite: 27 checks, including a new dealer allowlist check, plus 3 preview checks.
- Frontend conversation, Home and enquiry usability: 58 checks.
- 129 automated checks in those suites, all passing. Affected suites were rerun after the final small changes.
- Full workspace build/typechecks passed. Existing bundle-size advisories remain.
- Live browser layouts inspected at measured CSS widths 390 (phone), 834 (tablet) and desktop sizing. Phone/tablet document width matched viewport width without horizontal overflow.

## Device alerts and limits

Render initially had no Web Push configuration. Generated a VAPID key pair and saved it privately, scoped to `shore-drive-limited`. The live Device alerts panel now offers “Enable notifications”. No browser was silently enrolled and no permission prompt was accepted. Physical phone/tablet lock-screen delivery remains unverified until staff opt in on their own devices. Browser-size checks are not physical-device tests.

Incoming attachment names/counts are shown, but their binaries are still viewed in Resend. Previously sent emails retain their old Reply-To addresses. Direct sales emails without an enquiry and account invitations retain their existing reply settings.
