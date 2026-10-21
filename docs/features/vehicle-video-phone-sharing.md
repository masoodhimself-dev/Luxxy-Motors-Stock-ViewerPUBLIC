# Vehicle videos and phone sharing

Implemented on `codex/vehicle-video-phone-sharing`. Not deployed. Migration 0048 has only been exercised in disposable tests.

## Staff workflow

Cars → open a car → Car video → upload a clip → review compressed draft → explicitly tick review and publish. A replacement does not remove the previous public video until publication. Remove from website unpublishes; retained objects are not destroyed. Public playback and its share link require the car to remain publicly advertised. Private previews require staff authentication and sales.manage.

Accepted sources: MP4/MOV/WebM, at most 20 seconds, 200 MiB and 4096 pixels on either side (9 million pixels maximum). Server probes actual bytes, refuses playlists, compresses to H264/AAC MP4 at at most 720 pixels and 5 MiB, strips metadata, and checks the result. Client preflight is advisory; server validation remains authoritative. No automatic trimming or autoplay. Browser-incompatible source codecs may require conversion to MP4 before upload, particularly HEVC MOV on some browsers.

One encoder per application process; 90-second encode deadline, 60-second idle and 180-second absolute upload deadline. Busy requests return 429/Retry-After. Upload UUID and content digest make identical retries safe. Revision checks protect publishing. Stale processing attempts can be retried after three minutes. Per dealer: 40 new upload records/day, 1000 retained records and 2 GiB reserved/recorded storage. Removed/replaced clips remain retained; quotas fail closed pending an operator retention review. No automated deletion is enabled.

## QR sharing coverage

- Issued invoices, deposit invoices, receipts and credit notes: issued-document view and saved-paperwork actions; latest invoice also has a summary shortcut unless it needs a tax reference.
- A full invoice with an enabled Road Tax guide includes the guide when a valid green-slip reference is supplied. This uses its existing immutable snapshot and attachment builder, without changing the invoice.
- Reviewed enquiry messages: QR alongside Send email, containing the reviewed message and selected vehicle brochure, service/pre-accident photos, appointment calendar and document attachments. Stock-change and sold-vehicle drafts use this same composer. Existing context/revision checks still apply.
- Public vehicle pages, brochures, published walkaround videos and the staff car-link copy action have direct QR links.
- Test-drive declaration links retain the existing QR workflow.
- Internal operator diagnostic/test emails are not exposed as customer sharing packs.

Scan → review → choose Share with customer, WhatsApp, copy or download. Nothing sends automatically. Opening/sharing does not mark an email sent, enquiry contacted, appointment cancelled or follow-up complete. Staff must record the actual outcome separately. Native file sharing depends on HTTPS and browser/device support; downloads and copy remain available. WhatsApp shares the expiring link, not an automatic attachment.

Private packs expire after 24 hours and can be revoked by their creator or authorised sales staff. Accounts staff can create packs from issued documents under payments.record. Tokens are generated in the browser, only hashes are persisted, and the token is in the URL fragment and a request header, not a query string. Anyone holding the full link can read the frozen pack until expiry/revocation. Do not forward it to unintended recipients. Packs are limited to eight files/8 MiB; 50 packs and 32 MiB encoded content per dealer/day. Expired content is cleared opportunistically when that dealer creates another pack; this is not a periodic deletion job. Revocation clears content immediately.

## Production configuration

Apply `lib/db/drizzle/0048_vehicle_video_phone_share.sql` through the existing migration runner before serving this release. Keep migrations additive on rollback; return to the previous application build and retain new rows/objects.

Use a PRIVATE S3-compatible bucket (for example Cloudflare R2). The application proxies authorised/range-aware playback; do not enable public bucket URLs. Required server variables:

```
VIDEO_S3_ENDPOINT
VIDEO_S3_BUCKET
VIDEO_S3_ACCESS_KEY_ID
VIDEO_S3_SECRET_ACCESS_KEY
VIDEO_S3_REGION=auto
```

Use bucket-scoped object read/write credentials. No browser secrets or direct object-storage credentials are required. Production has no persistent-disk fallback. `VIDEO_STORAGE_DIR` is accepted only outside production. Optional `FFMPEG_PATH`/`FFPROBE_PATH` override bundled executables. `ffmpeg-static` requires its allowlisted install build; verify Linux encoder/probe availability on Render during rollout. No new paid service, bucket or environment variable has been created by this implementation.

Suggested rollout: provision private storage, apply migration, deploy, then upload a fictional clip, check private preview and explicit publication, confirm public range playback, remove it, create/revoke a fictional document pack, and test camera scanning/native sharing on a physical iPhone, iPad and Android phone. Do not claim native-device verification from desktop viewport checks. The production S3 adapter and Render Linux binary installation require this rollout check; tests use the filesystem adapter and local encoder.

## Local verification

`pnpm --filter @workspace/api-server test:media-sharing` runs real encoding and disposable PGlite/localhost HTTP tests. No production database or email provider is used; external fetches are forbidden in the fixture. It covers MP4, MOV, WebM, exact 20-second audio, malformed/long sources, playlist rejection, metadata removal, draft isolation, auth/roles/origins/tenant isolation, publish revisions, ranges/HEAD, immutable invoice bytes, QR replay/revocation/expiry, current enquiry preview and no outbox creation.

UI tests cover file preflight, review before publish, explicit removal, public playback props, QR creation/retry/revocation, and phone share/file/download/cancellation behaviour. The complete UI suite passed 1686 tests; a subsequent focused suite passed 103 tests. The final backend suite passed 15 tests. Typechecking and production builds passed. Browser checks covered the Cars editor, public video playback, QR dialog and phone sharing page at phone/tablet/desktop sizes. A fictional PDF was downloaded through the actual phone-sharing page. Physical-device camera scanning and native share sheets remain unverified.

The loopback-only preview may be run with `MEDIA_SHARING_PREVIEW=true VIDEO_PREVIEW_FILE=/absolute/generated-clip.mp4 PORT=4202 BASE_PATH=/ pnpm --filter @workspace/luxxy-motors dev:preview`. It shows explicitly labelled sample video and fictional document packs only. Upload/publish writes are intentionally unavailable in this visual fixture. Actual uploads are tested through the isolated authenticated HTTP fixture. Production does not import this module.
