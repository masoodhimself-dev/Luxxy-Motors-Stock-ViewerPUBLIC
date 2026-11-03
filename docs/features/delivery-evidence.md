# Delivery evidence

The driver flow records evidence for one saved sale and delivery job. It does not confirm payment, alter stock or mark handover complete. Staff review and handover remain separate actions.

## Staff and driver routes

- Staff component: `SaleDeliveryEvidence`, with saved `saleId` and `revision` props.
- Staff API: `/api/staff/sales/:saleId/delivery-evidence`. Generation, history, revocation, printing, signed-paper uploads and photo reads require staff authentication and `sales.manage` permission.
- Private driver page: `/delivery-evidence/:token`, outside the public showroom and staff sign-in shell.
- Driver API: `/api/delivery-evidence/:token`, `/photos` and `/submit`.

The generated 256-bit token is retained only by the caller; storage contains its SHA-256 digest. The default link lasts 72 hours, with a maximum of 168 hours. A new open job withdraws the previous unfinished link. Vehicle, customer and delivery details are frozen in a snapshot and compared with current arrangements before every driver read or write. Changed or revoked jobs require staff recovery; pending evidence is not silently attached to another job.

Job and photo queries always include the current dealer. Photos are stored privately in PostgreSQL and streamed only through authenticated staff endpoints. The public capability cannot read photographs, prices, payments, invoices, customer email or unrelated stock. API responses, print pages and capability HTML require no-store and no-referrer protections; token-bearing URLs and parser errors must also use the app's capability log redaction.

The vehicle file has a folded **Delivery evidence** section. It lists the vehicle’s linked sales, including previous returned sales, and loads a report only when staff open it. Reports and photos use the same `sales.manage` permission and authenticated sale endpoints as the deal. No driver token is retained in the file.

Every relevant saved change withdraws unfinished driver jobs inside the sale transaction. This includes changed delivery details, changing to collection, an unsuccessful job, handover, cancellation, release or a returned sale. Changing the details back later does not revive the old link. A rolled-back save leaves the current link usable. Already-received reports and their photos remain immutable.

## Evidence

A completed delivery requires arrival photos of the front, rear, both sides and dashboard; departure/damage images are optional. A failed delivery records a reason without pretending it completed. The report records driver/recipient names, declared actual handover time, mileage, keys, documents, condition exceptions and recipient acknowledgement.

Location is requested only when the driver chooses **Use current location**. The API stores coordinates, reported accuracy and device capture time, or a reason why location is unavailable. Device coordinates and times are supporting evidence, not proof of identity or physical delivery.

The browser compresses images before upload. The server independently bounds, decodes and re-encodes JPEG/PNG/WebP pictures, stripping EXIF and embedded metadata. Each file is limited to 2 MiB; the digital flow permits up to 16 photos and 16 MiB per job. Upload and final report request IDs allow exact retries. Conflicting retries fail; accepted reports remain immutable. Each photo has a device-added timestamp and a separate server received timestamp. A success screen appears only after the final report is acknowledged by the server.

## Limited reception and paper

An already-open form saves its current report and photographs in IndexedDB when device storage is available. Uploading resumes explicitly when the driver retries; already-acknowledged photographs are skipped. This implementation does **not** add an offline service worker or promise that the page itself can be reopened without reception. Browser storage can fail or be cleared. The interface tells the driver to keep the page open and carry the printed declaration.

Each network operation times out after 25 seconds so the driver can retry a stalled connection using the same request identities. Device-storage opening has a four-second bound. A warning protects an entered report when leaving, including after all photographs have uploaded but the report itself has not been acknowledged. Restored drafts older than seven days are removed when accessed.

The A4 declaration uses a restrained invoice-style ledger layout, includes the saved car/customer/delivery details and has spaces for actual mileage, condition exceptions and driver/recipient signatures. Staff can later upload a JPEG/PNG/WebP photograph of the signed original and transcribe its handover details. The report is marked as a paper source, records who entered it and preserves the actual handover time separately from the upload time. An expired link does not prevent staff saving the matching paper record. Revoked or changed jobs require staff review rather than automatic attachment. PDF uploads and supplementary evidence after a completed report are not currently supported.

Final review can fetch a bounded evidence summary: current job state, outcome, image counts, paper source, acknowledgement, keys/documents, mileage, recorded times, redacted condition notes, and whether location was recorded with its reported accuracy. Raw photos, coordinates, recipient contacts and private links are excluded. An immutable report digest and current evidence state are hashed so a later report invalidates the previous review even when the saved sale revision did not change. These observations support staff review; they do not certify physical delivery, payment or legal acceptance.

## Verification

From `artifacts/api-server`:

```sh
node test-delivery-evidence-build.mjs
node --test dist-test/delivery-evidence.test.mjs
```

The isolated PGlite suite exercises the real migration and persistence code: tenant boundaries, token hashing, safe retries, expiry/revocation, changed arrangements, private reads, required photos, immutable reports, unchanged sale money, print escaping and signed-paper recovery.

From `artifacts/luxxy-motors`:

```sh
node node_modules/vitest/vitest.mjs run src/pages/delivery-evidence.test.tsx
```

The component suite verifies explicit location permission, uploads before report submission, offline behavior, retained drafts, and isolation when the driver opens a different job while a photo or location request is pending.
