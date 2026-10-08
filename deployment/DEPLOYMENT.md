# Isolated Ubuntu deployment

Do not copy over any existing site's configuration. Check DNS, the installed Node version, existing systemd services, and `sudo ss -ltnp` before selecting a loopback port. This example uses `/srv/nullchannel`, a new `nullchannel` service user, and port 5050; adapt all three files consistently. Node must satisfy the locked dependencies' engine requirements (Node 22.12+ or a compatible supported newer release). Use the VPS's existing compatible executable or an isolated installation; do not replace global Node for other applications.

## Install and build

```sh
sudo useradd --system --home /srv/nullchannel --shell /usr/sbin/nologin nullchannel
sudo install -d -o "$USER" -g "$USER" /srv/nullchannel
cd /srv/nullchannel
git clone https://github.com/Arbab-ofc/NullChannel.git .
# For an existing checkout: git pull --ff-only (review local changes first).
npm ci
npm run typecheck
npm run lint
npm test
# Production API/socket endpoint defaults to the frontend's origin.
VITE_API_URL= npm run build
```

Deploy the reviewed revision containing these changes. Do not expect an unchanged remote checkout to contain unpushed local fixes. Build as a deployment user, not the service user. After building, keep source/environment files out of the static web root. Only `client/dist` is public.

## Database migration

Take a Supabase backup and review existing RLS policies. The backend uses the service role, never a browser Supabase key. Version 11 intentionally removes public/anon/authenticated access to application tables and RPCs; if other applications share these tables, assess that integration before applying.

For a new installation, apply `server/supabase/schema.sql` then every migration v2 through v12 in order. For an existing installation, apply only the missing migrations in order through v12. Apply using Supabase SQL editor or `psql` with the server-only PostgreSQL connection string. Do not use a service-role API key as a PostgreSQL password. Supply the DSN through a protected file/environment, not shell history.

```sh
psql "$NULLCHANNEL_MIGRATION_DSN" -v ON_ERROR_STOP=1 -f docs/supabase-migration-v12.sql
```

Migration is transactional and additive to data; v11 changes table/RPC access grants. It does not claim historical identities or alter old messages. Legacy sessions must establish new identity; existing rooms may have reserved inaccessible legacy slots until expiry. Inform users and prefer the release transition when temporary rooms have naturally expired. Do not automatically wipe production rooms to migrate.

Legacy `file_path` records may actually contain an ImageKit file ID (the old frontend preferred `fileId`); other versions may contain actual paths. Run the reconciliation command below to validate each candidate with ImageKit before setting `messages.file_id`. URLs are never parsed to guess IDs. Read-only dry-run is the default. Reconcile before enabling cleanup if old attachments still require retention/deletion:

```sh
cd /srv/nullchannel/server
npm run reconcile-media
# After reviewing the dry-run output:
npm run reconcile-media -- --apply
```

After the build and any reviewed legacy-media reconciliation, omit the development toolchain from the runtime installation:

```sh
cd /srv/nullchannel
npm prune --omit=dev
```

For an update, restore build dependencies with `npm ci`, run the checks/build, and prune again before restarting only `nullchannel`.

## Configure systemd

```sh
sudo install -d -m 750 -o root -g nullchannel /etc/nullchannel
sudo install -m 640 -o root -g nullchannel deployment/server.env.example /etc/nullchannel/server.env
sudoedit /etc/nullchannel/server.env
sudo install -m 644 deployment/nullchannel.service.example /etc/systemd/system/nullchannel.service
sudoedit /etc/systemd/system/nullchannel.service
sudo systemctl daemon-reload
sudo systemctl enable --now nullchannel
sudo systemctl status nullchannel --no-pager
curl --fail http://127.0.0.1:5050/api/health
curl --fail http://127.0.0.1:5050/api/health/db
sudo journalctl -u nullchannel -n 100 --no-pager
```

Use genuine credentials in the protected environment file. Ensure `CLIENT_URL` is the exact HTTPS origin (no trailing slash). `HOST=127.0.0.1` prevents public direct access. The service user only needs read/execute access to `/srv/nullchannel/server` and dependencies. Do not make it owner of other applications or store secrets in `client/.env`. The SDK uses HTTPS requests, so there is no persistent PostgreSQL connection pool to close.

## Add Nginx and HTTPS

Ensure this domain's A/AAAA records reach the VPS. Install Nginx/Certbot only if they are absent, using the VPS's existing package strategy. Leave existing certificate tooling intact. First install and validate the new HTTP site:

```sh
sudo install -m 644 deployment/nginx.conf.example /etc/nginx/sites-available/nullchannel
sudoedit /etc/nginx/sites-available/nullchannel
sudo ln -s /etc/nginx/sites-available/nullchannel /etc/nginx/sites-enabled/nullchannel
sudo nginx -t
sudo systemctl reload nginx
```

Replace the example hostname and port before enabling. Use the installed Certbot, or follow the [official Ubuntu/Nginx installation instructions](https://certbot.eff.org/instructions?ws=nginx&os=snap). For a new snap installation, install snapd if necessary, then `sudo snap install --classic certbot` and invoke `/snap/bin/certbot` directly. There is no need to overwrite `/usr/bin/certbot`. Request only the new site's certificate:

```sh
sudo certbot --nginx -d YOUR_ACTUAL_DOMAIN --redirect
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Certbot obtains the actual certificate and adds the matching HTTPS listener/paths. No unissued certificate paths are hardcoded in the template. Review the diff to ensure existing sites remain untouched. After HTTPS is working, add `Strict-Transport-Security "max-age=31536000" always` to this HTTPS virtual host (without `includeSubDomains` unless appropriate for your actual domain). API Helmet also supplies production HSTS. WebSocket upgrade settings follow [Nginx's official documentation](https://nginx.org/en/docs/http/websocket.html).

```sh
sudo systemctl restart nullchannel
curl --fail https://YOUR_ACTUAL_DOMAIN/api/health
curl --fail https://YOUR_ACTUAL_DOMAIN/api/health/db
sudo journalctl -u nullchannel -f
```

Verify in a browser: two private-room participants, a rejected third participant, group rooms, text/edit/delete/reactions/pin, images/voice/files, reconnect, refresh, extension, expiration and panic wipe. This needs genuine staging Supabase and ImageKit credentials; automated isolated tests are not proof that your DNS/TLS/external account configuration works.

## Environment variables

| Name | Purpose | Required / secret | Development / production |
|---|---|---|---|
| NODE_ENV | Runtime mode, secure cookie policy | Optional / public | development default; production required for deployment |
| HOST | Listening interface | Optional / public | 127.0.0.1 default in both modes |
| PORT | Backend port | Optional / public | 5050 default; choose unused VPS port |
| CLIENT_URL | Exact allowed browser origin and CSRF Origin | Required / public | http://localhost:5173; real HTTPS origin in production |
| SUPABASE_URL | Server Supabase project endpoint | Required / public | disposable project in tests/staging; production project on VPS |
| SUPABASE_SERVICE_ROLE_KEY | Server-only database API authorization | Required / **secret** | never in VITE variables or browser bundle |
| IMAGEKIT_PUBLIC_KEY | ImageKit SDK public identifier | Required / public | configured on backend only |
| IMAGEKIT_PRIVATE_KEY | ImageKit API authorization | Required / **secret** | backend-only |
| IMAGEKIT_URL_ENDPOINT | Media delivery endpoint | Required / public | ImageKit account endpoint |
| CLEANUP_SECRET | Optional external POST /api/cleanup credential | Optional / **secret** | unset disables trigger; cron does not need it |
| UPLOAD_CONCURRENCY | Simultaneous parsed uploads per process | Optional / public | 2 default, maximum 8 |
| SOCKET_JOIN_LIMIT | Joins per identity/minute | Optional / public | 30 default |
| SOCKET_MESSAGE_LIMIT | Messages per identity/minute | Optional / public | 120 default |
| SOCKET_TYPING_LIMIT | Typing events per identity/minute | Optional / public | 180 default |
| DATABASE_TIMEOUT_MS | Supabase HTTP request deadline | Optional / public | 15000 ms default; 1000–60000 |
| SOCKET_CONNECTION_LIMIT | New transport connections per network address/minute | Optional / public | 60 default; trusts forwarded IP only from loopback Nginx |
| IMAGEKIT_TIMEOUT_MS | Provider HTTP deadline | Optional / public | 60000 ms default; 1000–120000 |
| REST_MUTATION_LIMIT | Message mutations per identity/minute | Optional / public | 120 default |
| REST_MANAGEMENT_LIMIT | Room management per identity/minute | Optional / public | 20 default |
| VITE_API_URL | Optional public backend origin | Optional / public | leave empty for Vite proxy/same-origin VPS; existing same-site localhost URLs still supported |
| TEST_DATABASE_URL | Disposable test database DSN | Tests only / **secret** | localhost DB name must start nullchannel_test; never production |

API and Socket.IO use HttpOnly SameSite=Strict credentials. Cross-site hosting is intentionally unsupported by this cookie policy; the documented deployment is same-origin. API clients issuing writes must send the matching `Origin`. Short-lived access cookies are renewed with the 30-day absolute refresh session; revocation ends authorization. Lost/expired refresh credentials create a fresh identity without granting access to previous ownership.

Default buffered upload budget is two 15 MiB files = 30 MiB raw file data. Multer/SDK conversion and HTTP buffering add transient copies; allow at least 3x that plus baseline process memory and measure your VPS. Nginx buffers request bodies to its managed temporary storage; backend rejects files over 15 MiB, images over 5 MiB, and audio over 10 MiB. Busy upload slots return 503/Retry-After; multipart overflows return clear 400/413 responses.

Burn cleanup runs immediately at startup and every second in bounded batches (50 rooms/500 messages). Deadlines survive restart; history, individual reads and quoted replies exclude overdue messages even before physical cleanup. Room/media cleanup runs immediately at startup and every minute, processes up to 100 rooms and 20 media jobs per run, and uses PostgreSQL locks/leases. Access expiry is checked on every room read/write regardless of cleanup schedule. Monitor `media_cleanup` retries and orphan legacy attachments. Media links remain public ImageKit URLs and messages remain plaintext at the backend; HTTPS transport is mandatory. This release does not provide E2EE or guaranteed deletion from participant devices, provider backups, or cached public media.

Membership and presence are distinct: private-room capacity counts persistent, non-left memberships (with a creator slot reserved), not socket connections. Multiple tabs and reconnects consume one membership. `online` in the participant API and presence events counts unique authenticated identities currently in the Socket.IO room. Plain disconnect never removes membership; explicit leave revokes all that identity's sockets in the room.

The example CSP allows the default ImageKit delivery host; replace that host when using a custom ImageKit endpoint. Keep same-origin connect-src for API and Socket.IO, and verify voice recording under the supplied microphone policy. Five development-only advisory entries remain in the Tailwind/braces chain; braces has no published fix at verification time. Do not use this development toolchain to process untrusted glob patterns or expose its dev server publicly. A separate upgrade review is needed before migrating Tailwind major versions.

Upload intent records are written before contacting ImageKit. Ambiguous upload responses or registry outages are recovered by matching the provider's exact generated path, and only its returned file ID is queued for deletion. Intent recovery and media deletion both use database leases and retry backoff. Expired/revoked session records are pruned in bounded batches. Unknown legacy attachments and already-deleted historical records cannot be reconstructed safely. Generic MIME uploads are accepted only for known supported extensions whose content passes the same signature checks; arbitrary octet-stream attachments are rejected.

For the v12 UX release, follow the coordinated migration and rollback instructions in [UX_POLISH.md](../docs/UX_POLISH.md). Never serve this backend against a pre-v12 schema.

V12 requires a coordinated backend/frontend release, with the old backend stopped before migration and old browser tabs reloaded for burn receipts. See [the migration audit](../docs/MIGRATION_V12_AUDIT.md). Migration lock waits/statement duration are bounded; a timeout or v11 trigger/grant precondition failure rolls back rather than continuing unsafely.
