# Cazoo SFTP collection

This document covers collecting Multi-Choice Motors' official CSV from Hetzner. Downloading and validating a file is separate from applying it to vehicle records. Keep imports paused until the identity migration and import checks are approved. Preparing this integration does not configure a live schedule or deploy it.

## Control-panel verification is separate

Hetzner Console may request an email code when an administrator signs in. The collector does not sign into Console: it connects directly to the account's SFTP hostname on port 22. Keep Console verification enabled. External reachability must be enabled for connections from Render. Port 23, interactive SSH, SMB and WebDAV are unnecessary for this transfer. Use the hostname rather than an IP address. [Hetzner SFTP access](https://docs.hetzner.com/storage/storage-box/access/access-sftp-scp/), [access overview](https://docs.hetzner.com/storage/storage-box/access/access-overview/).

## Account scope

The existing Cazoo uploader must retain access to its existing incoming directory. Do not change its password, home directory or write permissions merely to prepare a downloader.

Hetzner supports a configured home directory and a `readonly` access setting per subaccount. A separate downloader can therefore request the same incoming directory and read-only access; verify that Hetzner accepts the requested setup and enforces its boundaries. Do not give the application the Storage Box main account. [Official subaccount schema](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/schema/storage_box_subaccount.go).

There is an additional key-isolation consideration: Hetzner stores authorized public keys in `.ssh/authorized_keys` under an account's home. Two accounts with the same home would refer to the same file. Until tested or confirmed by Hetzner, do not claim that a reader's key installed there cannot also authenticate as the writable uploader. A stronger key-based directory design gives the reader its own parent directory and `.ssh`, with the writer restricted to an `incoming` child directory. Changing the existing layout requires a separate planned migration.

The selected design uses a distinct read-only account with its own password and the existing incoming home directory. No new authorized SSH key is required. This retains Cazoo's current upload account and directory. Confirm the new account's read-only setting and directory confinement before enabling it. Collection must never upload, rename, delete or chmod the supplier's files.

## SSH key alternative, if needed later

Create a dedicated key pair in a private location outside tracked source and output folders. Never reuse a personal administrator key. Keep the private key secret; only its public counterpart belongs on Hetzner.

For port 22, export the public key in RFC4716 format. RSA, ECDSA and ED25519 are supported. Install it in the intended account's `.ssh/authorized_keys`, retaining existing entries and a final newline. Do not copy over that file blindly: Hetzner warns that doing so removes existing keys. Installation can be performed through SFTP without enabling port 23. If an account is already read-only, an authorized writer or administrator must install its public key. [Hetzner key installation](https://docs.hetzner.com/storage/storage-box/ssh-keys/add-ssh-keys/), [supported formats](https://docs.hetzner.com/storage/storage-box/general/).

Compare the server's host-key fingerprint against Hetzner's published fingerprint through a trusted channel before pinning its complete host-key entry. An unverified `ssh-keyscan` result is not identity verification. A changed host key must stop collection and require investigation; never automatically accept it.

## Runtime and secret handling

This repository uses Node 24 with an esbuild-bundled API server and Render's native Node runtime. The selected transport is the `ssh2` Node library with password authentication, not an operating-system executable. Local macOS has `/usr/bin/sftp`, but Render's documented native-runtime tool list does not promise it. The library avoids that runtime assumption and supports the separate read-only account without shared authorized keys. [Render native runtimes](https://render.com/docs/native-runtimes).

Require password-only authentication, pinned host verification, bounded connection time and an overall transfer deadline. Do not use a personal SSH agent, interactive authentication, shell commands or FTP fallback. Bound transferred bytes and validate the hostname, username and remote path. Expose only the SFTP metadata/read operations needed by the collector. Keep passwords and connection objects out of logging.

`ssh2` accepts unknown hosts by default when no `hostVerifier` is provided: install an explicit verifier. When comparing an OpenSSH `SHA256:...` fingerprint, hash the raw host-key bytes to SHA-256 base64 without padding. Setting `hostHash: 'sha256'` instead supplies a hex string, which must not be compared directly with that base64 fingerprint. `readyTimeout` covers the handshake; the collector also needs a transfer deadline. [ssh2 client configuration](https://github.com/mscdex/ssh2#client-methods).

`ssh2` is externalized by the existing server build. Install it as a production dependency, retain the lockfile change, and smoke-test the bundled server with production dependencies available. Optional native acceleration must not be required for correctness.

For a later approved Render rollout, store each reader password in a separate service-scoped secret environment variable. The connection configuration holds only its variable name under `passwordEnv`, never the password value. Never commit passwords, keys or secret values to a Blueprint, generated report or browser bundle. Render configuration changes can trigger a deployment, so stage them only in the approved release window. [Render secrets](https://render.com/docs/configure-environment-variables).

## Configuration and scheduling

`CAZOO_SFTP_ENABLED` defaults to `false`. `CAZOO_SFTP_CONNECTIONS_JSON` contains an array of dealer-bound connection descriptions with these fields:

| Field | Purpose |
| --- | --- |
| `dealerId` | Exact internal dealership identifier; never inferred from CSV data |
| `retailerId` | Exact configured stock retailer reference |
| `feedId` | Expected CSV `Feed_ID`, currently `AETA22820` for this delivery |
| `dealerName` | Approved public dealership name |
| `host` | Dedicated read-only subaccount's Hetzner hostname |
| `port` | `22` |
| `username` | Dedicated read-only subaccount username |
| `remotePath` | `/cazoo.csv` within that account's restricted root |
| `passwordEnv` | Name of the service-scoped secret variable containing its password |
| `hostFingerprint` | Independently verified OpenSSH `SHA256:...` host fingerprint |

For example, `passwordEnv` can name `CAZOO_SFTP_PASSWORD_MULTI_CHOICE`; its value is supplied privately at runtime. Validate the entire configuration before connecting. Reject duplicate dealership entries and missing or unsupported fields rather than binding a file to a different dealer.

Collection windows begin at 07:10 and 19:10 in Europe/London, after the supplier's stated deliveries. The local worker wakes every ten minutes, with network reads restricted to those 90-minute windows; retryable failures have a 15-minute minimum delay and a maximum of three attempts per slot. Reuse the existing web service's lightweight timer; a new paid cron service is not required. The PostgreSQL repository uses dealer-scoped session advisory locks and persistent slot/attempt rows so a restart or another instance cannot reset the budget or repeat a completed slot. Deployment and production schedule activation require approval.

## Transfer lifecycle

1. Acquire a lock scoped to the dealership; reject overlapping runs.
2. Connect with the intended restricted account and inspect the configured CSV's metadata.
3. Require a stable file before accepting it. If supplier-side atomic rename is not guaranteed, compare metadata before and after transfer and use an agreed stability interval. A changed file is retried later, never imported as a partial snapshot.
4. Download into a bounded memory buffer with a size limit and deadline. Never modify the remote file.
5. Validate encoding, CSV structure, required columns, dealer/feed identity, unique vehicle identifiers and expected data ranges. Retain truthful file and observation times.
6. Hash the bytes. Record the successful observation independently from stock changes; identical deliveries should not create repeated imports.
7. Save the validated candidate, reconciliation and concise result in the private `cazoo_feed_checks` database table. Keep credentials out of every saved field. Release connections and locks in success and failure paths; do not retain transfer buffers after processing.

Migration `0075_cazoo_feed_checks.sql` adds the private candidate/checkpoint table with a unique dealership/slot index and status, retry-count, hash and nonnegative-count constraints. The repository stores progress before opening SFTP and saves the final candidate separately from stock. Previously ready files remain available when a later check fails. Completed identical files reference the previous ready candidate instead of duplicating it. No protected business table is updated by these collection queries.

## Unattended proof before import enablement

Test the real configured collector with its terminal input closed and no browser, Console session, password prompt or SSH agent. Resolve the password only from its configured private runtime variable. Record start/end times, byte count, SHA-256, validated dealer ID and vehicle count. A timed-out prompt is a failure, not unattended success.

Run it twice: the second identical file should validate without generating a second stock mutation. Verify failures for missing dependency, missing password variable, wrong host key, authentication failure, missing file, timeout, oversized or changing file, malformed CSV and wrong dealer ID. Previous validated state must remain available after each failure. Concurrent runs must not both proceed. Verify the server cannot cause unbounded reads by reporting a misleading file size. For scheduled tests, include a late delivery: the previous slot's file must not be mistaken for the current delivery and suppress later retries merely because its bytes match.

Where a server-enforced read-only account is provisioned, confirm reads work and cross-folder access is denied. Verify denied writes only with an explicitly approved disposable test file; never attempt to overwrite or remove `cazoo.csv`.

A successful manual unattended transfer proves noninteractive authentication, not that a future scheduler fired. Prove each scheduled slot separately from its actual execution records. Confirm the supplier's 07:00/19:00 timezone and upload completion window before selecting check times; use Europe/London deliberately if those are UK local times. The worker logs only concise operational summaries. Blocked checks and exhausted retries produce a warning in Render logs; no staff push, email or customer notification is introduced. Completed-slot restarts produce no repeated summary.

## Stock ownership after the switch

The official Cazoo file becomes Multi-Choice's stock authority after the approved migration. Preserve vehicle UUIDs and all customer, booking and sale relationships while reconciling Cazoo's `AETV...` identities with existing records. Replacing imported catalogue information must not rewrite invoices, payments, deposits, reservations or sold status. No collection-only command should invoke the stock import endpoint. Grok and other dealerships' schedules and credentials remain unchanged until their specific transition is authorized.
