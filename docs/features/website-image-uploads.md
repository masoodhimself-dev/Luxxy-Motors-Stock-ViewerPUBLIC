# Website image uploads

Owners can upload public PNG, JPEG and WebP logos and presentation photographs from Website settings. Existing hosted image URLs remain supported. This is separate from private service-book/customer attachments and never publishes vehicle or website changes automatically.

## Flow and API

- `POST /api/staff/website-assets` requires signed-in staff with `settings.publish` on the request's resolved dealership. Existing verified-origin protection applies.
- The JSON body is `{ "requestId": "<UUID>", "image": "data:image/png;base64,..." }`. Maximum HTTP request size is 3 MB; decoded input and normalized output each have a 2 MiB limit.
- Successful creation returns `201`; an identical retry returns `200` with the same ID and `replayed: true`. Reusing a request ID for different bytes returns `409`. Request IDs are scoped per dealership.
- The response contains only `id`, `url`, `mimeType`, `width`, `height`, `byteSize` and `replayed`. The URL uses the dealership's canonical origin.
- `GET /api/website-assets/:id` serves only normalized image bytes belonging to the resolved dealership. Invalid/other-dealer IDs return `404`. `HEAD`, immutable cache headers and ETag validation are supported. Demos retain `no-store` caching and the tenant middleware's indexing/expiry restrictions.
- Uploading puts the returned URL into the ordinary settings draft. Review and publish remain separate actions, with existing revision/permission controls. Failed publication or leaving the editor does not delete the uploaded image.

Images at these URLs are public, including images uploaded into an unpublished draft. The upload control must make that clear; private documents must use their existing private workflow.

## Storage and validation

Migration `0047_dealer_website_assets` stores small immutable public asset bytes in PostgreSQL, so an ephemeral filesystem or additional storage account is unnecessary. Deleting a file from an operator's computer does not remove the stored asset. Existing settings history can keep referring to an older image.

The server checks actual PNG/JPEG/WebP headers and bounds dimensions before decoding. It accepts still images only, with at most 4096 pixels on either side and 12 million pixels total. Native decoding and fresh raster encoding remove original metadata, GPS/EXIF data and comments; PNG/WebP transparency is retained. SVG, GIF, files mislabeled as supported raster formats and undecodable content are rejected. The native decoder receives bytes only, never a file path or remote URL.

Only two image decodes can be active in a process; additional requests receive `429` and `Retry-After: 2`. A dealer-scoped transaction lock enforces at most 100 images and 50 MiB total stored bytes. There is no public asset listing, overwrite or deletion endpoint. Allowance exhaustion needs operator review; automated deletion is deliberately absent because draft and historical settings can reference older assets.

`@napi-rs/canvas` version 1.0.11, already present in the lockfile through the PDF tooling, is an explicit API runtime dependency. The server build leaves it external so its platform-native package is loaded normally on Render. No new client environment variables or credentials are required.

## Verification

The isolated API tests use generated fictional raster images, an in-memory PGlite database and a localhost-only HTTP server. They check actual raster decoding and transparency, metadata stripping, malformed/oversized content and unsafe dimensions, concurrent decoder admission, owner/role/origin/tenant boundaries, canonical URLs, request replay/conflict, immutable bytes/ETag/HEAD, quota enforcement, database constraints, and unchanged published settings/stock.

Run from `artifacts/api-server`:

```sh
node test-website-assets-build.mjs
node --test .cache/website-assets-tests/dealer-website-assets.test.mjs
```

This does not certify physical iPhone/iPad/Android file pickers or a production migration/deployment. No provider call, real dealership asset, published settings, email or stock import is used by these tests.
