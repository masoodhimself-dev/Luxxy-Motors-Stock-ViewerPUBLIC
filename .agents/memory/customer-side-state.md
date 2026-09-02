---
name: Customer-side state
description: Why shopper-facing personalisation on the showroom is stored in the browser rather than the database.
---

There are no customer accounts on this project. The only login is the dealer portal, and it is
single-dealer. Anything a *shopper* personalises therefore has nowhere to live server-side.

**Rule:** shopper-facing personalisation (shortlists, comparisons, recently viewed, dismissed
banners) is stored in `localStorage` under a versioned `luxxy.<feature>.vN` key. Do not add
customer tables, customer auth, or API endpoints for it unless the user explicitly asks for
customer accounts, which is a much larger change.

**Why:** adding a customer identity to persist a shortlist would drag in auth, sessions, GDPR
duties over customer records, and a second permission model beside the dealer portal — all for
state the browser already holds well.

**How to apply:** wrap the store in a context provider that reads once on mount, writes on
change, and listens for the `storage` event so a second tab stays in step. Guard every read and
write with try/catch: private browsing and full quotas make them throw, and the showroom must
still render. Reconcile stored ids against live stock whenever the list is shown — a sold car
must not keep occupying a slot — but never prune against an empty stock response, which is far
more likely to be a failed fetch than a sold-out forecourt.
