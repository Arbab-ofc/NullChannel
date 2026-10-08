# 1. Executive Summary

Implemented production hardening directly in the existing React/Vite/Express/Socket.IO application. Supabase PostgreSQL and ImageKit remain in place. Existing styles, theme, animations and layouts were not edited. Anonymous onboarding now obtains a backend-issued identity without registration. No production deployment, production database change, Git push or PR was performed.

The final executed suite passed **84 tests**: 64 backend and 20 frontend/library tests. Twelve tests exercise a real disposable PostgreSQL database; HTTP/Socket.IO tests use real transports with isolated database/provider boundaries. Separate real backend process tests verify readiness failure and SIGTERM/SIGINT shutdown. Both builds, application TypeScript checks and lint passed. Runtime dependency audit reported zero vulnerabilities. Full dependency audit still reports five high advisory entries in the development-only Tailwind/braces chain.

This is a completed local implementation and deployment preparation, with a conservative **NOT READY for unconditional production release** verdict until genuine staging provider integration, visual browser regression, and target VPS Nginx/TLS checks are completed. The user explicitly deferred live provider integration and confirmed that no staging environment is available. Production database, credentials and VPS remain untouched.

# 2. Verified Problems

| Problem / severity | Affected files | Root cause | Implemented fix |
|---|---|---|---|
| Identity impersonation — Critical | sender hook, REST controllers/routes, socket handlers | Client UUIDs were accepted as identity evidence | Backend random access/refresh credentials, hashed storage, HttpOnly cookies, server-derived identity throughout |
| Unauthorized history/participant access — High | room controller/routes | Reads lacked membership authorization | Persistent membership and expiry guards; visitors receive only the minimal code/title/type/expiry needed for joining |
| Private capacity races / fail-open joins — High | membership service, socket handler | Count then upsert, swallowed validation errors | PostgreSQL row lock and transactional join; creator slot reservation; fail closed before socket subscription |
| Creator/message ownership spoofing — Critical | REST/socket identity paths | Ownership checks existed but compared attacker-controlled UUIDs | Existing ownership rules now compare authenticated identity; participant access checked independently |
| Upload memory exhaustion — High | media route | Unbounded memoryStorage before size checks | Middleware 15 MiB file cap, one file, three fields, 256-byte fields, bounded parts/names and two active slots by default |
| Upload reference forgery and MIME trust — High | media controller, message persistence | Client chose file URL/path/type metadata | Server-owned registry and one-use database claim; signatures; supported extension inference for generic MIME |
| Media deletion loss — High | media/cleanup/message/room services | Paths and IDs were interchangeable; errors ignored before deleting metadata | Separate file_id, transactional queue triggers, leased independent retries and provider-confirmed legacy reconciliation |
| Ambiguous remote upload / DB failure orphans — Medium | media service/controller | No durable record before contacting ImageKit | Generated exact-path write-ahead intent; safe recovery and unused-upload queue |
| Socket authorization/rate gaps — High | socket bootstrap/handlers | No handshake auth or event limits | Origin/cookie handshake validation; event session revalidation, schema/payload caps and identity/network limits |
| Cleanup delay/failure handling — Medium | server, cleanup service | Fifteen-minute sweep, unchecked deletion failures | Immediate access expiry remains enforced; startup/minute worker, bounded DB batches, locks, leases and backoff |
| Room create/extend/wipe consistency — Medium | room service | Multi-step operations / concurrent limits | Transactional RPCs and creator/type advisory lock for creation limits; wipe cutoff preserves subsequent live messages |
| Reconnect/history/cross-tab consistency — Medium | socket hook, ChatPage, message merge | No reliable rejoin; duplicate append; history overwrote live state; stale subscriptions | Authorized rejoin; single socket lifecycle; source-tested snapshot/live merge; navigation disconnect; unique online presence |
| Error disclosure / operational gaps — Medium | health/error/env/server/deployment | Raw health DB errors, incomplete shutdown/deployment setup | Sanitized correlated logs/responses; readiness schema check; graceful shutdown and isolated VPS templates |
| Vulnerable dependencies — High/Critical advisory entries | manifests, lockfile | Old direct/transitive versions | Compatible upgrades and targeted UUID/parser/shell overrides; existing Vitest updated; no Tailwind major migration |

Existing protections verified and preserved: Helmet, exact configured CORS origin, Zod input validation, Supabase SDK parameterized API operations, room/message foreign keys, unique membership/reaction constraints, service-role-only backend access, RLS enabled in the base schema, creator ownership checks, the two-minute text edit window, tombstones, and burn-after-read semantics. The original README already correctly disclaimed full E2EE.

# 3. Files Changed

Every changed or added tracked-source artifact is listed below. Generated build output is ignored by Git and is not a source deliverable.

| File | Purpose |
|---|---|
| `.env.example` | Document safe server tuning values without credentials. |
| `README.md` | Link deployment/report and correct session, cleanup, reconnect and media guarantees. |
| `client/.env.example` | Default browser traffic to the same-origin API and socket proxy. |
| `client/package.json` | Declare the existing Vitest runner for frontend tests. |
| `client/src/hooks/useLocalSender.ts` | Return the backend-authenticated identity instead of a localStorage UUID. |
| `client/src/hooks/useSocket.ts` | Manage the single socket lifecycle and disconnect on room navigation/unmount. |
| `client/src/lib/api.ts` | Use cookie credentials, bounded requests and one authenticated renewal retry. |
| `client/src/lib/constants.ts` | Support empty/same-origin VITE_API_URL and normalize trailing slash. |
| `client/src/lib/messages.ts` | Merge history snapshots with concurrent live edits, arrivals, burns and wipes. |
| `client/src/lib/session.ts` | Bootstrap/renew identity with cookie transport, cross-tab locks and safe identity transition. |
| `client/src/lib/socket.ts` | Authenticate through cookies and prevent reconnect after an unmounted renewal. |
| `client/src/main.tsx` | Initialize anonymous sessions before rendering and renew in the background. |
| `client/src/pages/ChatPage.tsx` | Preserve joining UX under authorization; fix reconnect, duplicate/history ordering, presence, uploads and timer cleanup. |
| `client/src/tests/api.test.ts` | Add regression coverage for one-shot session retry and actionable upload/expiration errors. |
| `client/src/tests/crypto.test.ts` | Add regression coverage for existing Web Crypto helpers only, without an E2EE claim. |
| `client/src/tests/messages.test.ts` | Add regression coverage for history/live synchronization and burn/wipe behavior. |
| `client/src/tests/session.test.ts` | Add regression coverage for identity issuance, renewal, expiry/revocation and transitions. |
| `client/src/tests/socket.test.ts` | Add regression coverage for single socket, reauthentication and cancelled renewal. |
| `client/vite.config.ts` | Proxy local API and Socket.IO without cross-site credential changes. |
| `client/vitest.config.ts` | Restrict test discovery to source tests. |
| `deployment/DEPLOYMENT.md` | Provide isolated Ubuntu commands, variable matrix, compatibility and operational limits. |
| `deployment/nginx.conf.example` | Add a separate same-origin SPA/API/WebSocket site with aligned upload limits, caching and security policy. |
| `deployment/nullchannel.service.example` | Run a dedicated unprivileged service with isolated environment, journald, restart and graceful shutdown. |
| `deployment/server.env.example` | List deployment variables with blank secret values. |
| `docs/PRODUCTION_READINESS.md` | Record verified fixes, every changed file, executed evidence and release gates. |
| `docs/supabase-migration-v11.sql` | Add sessions, upload registry/intents/cleanup, protected transactional RPCs and media lifecycle triggers; restrict public database access. |
| `package-lock.json` | Lock the verified patched dependency resolution for reproducible installation. |
| `package.json` | Run frontend and backend tests; apply targeted compatible security overrides. |
| `server/.env.example` | Document production/session/socket/upload timeout and rate settings. |
| `server/package.json` | Expose reviewed legacy-media reconciliation, update Vitest and declare the existing Axios transport. |
| `server/src/app.ts` | Mount session/auth/origin controls, trust loopback proxy, apply global budget and add request IDs. |
| `server/src/config/env.ts` | Validate exact origin, ports and tunable budgets; report invalid configuration without credentials. |
| `server/src/config/imagekit.ts` | Bound SDK request latency using its existing Axios transport. |
| `server/src/config/supabase.ts` | Bound database HTTP requests and preserve caller abort signals. |
| `server/src/controllers/health.controller.ts` | Readiness checks security schema and removes raw database error disclosure. |
| `server/src/controllers/media.controller.ts` | Bind uploads to session/membership, validate signatures and persist actual provider IDs with rollback/recovery. |
| `server/src/controllers/room.controller.ts` | Protect private reads and bind user-room lookup to authenticated identity; use durable deletion and cross-tab leave/presence. |
| `server/src/middlewares/auth.middleware.ts` | Verify opaque cookies, enforce exact Origin and check membership before private operations. |
| `server/src/middlewares/error.middleware.ts` | Return sanitized JSON errors including multipart overflow and log safe correlation/error codes. |
| `server/src/middlewares/rateLimit.middleware.ts` | Add identity-bound operation budgets and consistent JSON rate-limit responses. |
| `server/src/middlewares/security.middleware.ts` | Keep Helmet, configure credentialed exact-origin CORS and avoid development logging in tests/production. |
| `server/src/middlewares/upload.middleware.ts` | Limit active buffering/processing slots and release them correctly on completion or parse abort. |
| `server/src/routes/cleanup.routes.ts` | Bound the optional secret trigger and compare secret hashes in constant time. |
| `server/src/routes/media.routes.ts` | Set file, field, name, count and multipart limits before buffering; hold concurrency until processing completes. |
| `server/src/routes/room.routes.ts` | Apply persistent membership and authenticated mutation/management budgets. |
| `server/src/routes/session.routes.ts` | Issue/renew HttpOnly access/refresh cookies and revoke connected sessions. |
| `server/src/schemas/media.schema.ts` | Reject unexpected multipart payload fields. |
| `server/src/schemas/message.schema.ts` | Reject extra fields; bound media references and reactions to supported values. |
| `server/src/schemas/room.schema.ts` | Reject unexpected management/create payload fields. |
| `server/src/scripts/reconcile-media.ts` | Dry-run by default; adopt legacy IDs only after provider URL/folder verification. |
| `server/src/server.ts` | Run bounded nonoverlapping cleanup at startup/minutely; add structured startup and graceful signal/fatal shutdown. |
| `server/src/services/cleanup.service.ts` | Use transactional expiry RPC and durable leased media retries; handle partial failures independently. |
| `server/src/services/media-validation.ts` | Validate supported signatures and safely infer known MIME types when browsers send octet-stream. |
| `server/src/services/media.service.ts` | Write upload intents before provider calls, recover ambiguous uploads and queue owner-scoped unused uploads. |
| `server/src/services/membership.service.ts` | Replace fail-open read/upsert capacity logic with row-locked join RPC. |
| `server/src/services/message.service.ts` | Queue newly uploaded media when message persistence fails. |
| `server/src/services/room.service.ts` | Use atomic creation/extension/wipe RPCs and surface lookup/delete errors. |
| `server/src/services/session.service.ts` | Generate random server credentials; persist hashes; verify expiry/revocation and renew proven identities. |
| `server/src/sockets/emitter.ts` | Evict terminal/left sessions, revoke session sockets and report unique online identities. |
| `server/src/sockets/index.ts` | Authenticate handshakes, validate origin, cap payloads, limit real client addresses and monitor revoked/expired sessions. |
| `server/src/sockets/rateLimit.ts` | Bound per-identity event windows and their memory footprint. |
| `server/src/sockets/room.socket.ts` | Verify sessions per event, overwrite submitted IDs, join only after atomic authorization and preserve membership on disconnect. |
| `server/src/tests/api-socket.integration.test.ts` | Add regression coverage for HTTP/socket auth, spoofing, upload limits and multi-tab presence. |
| `server/src/tests/cleanup.test.ts` | Add regression coverage for partial cleanup failures, retry behavior and overlap. |
| `server/src/tests/database.integration.test.ts` | Add regression coverage for real migrations, atomic capacity, expiration, wipe, upload claim and grants. |
| `server/src/tests/dependencies.test.ts` | Add regression coverage for existing SDK compatibility after UUID patching. |
| `server/src/tests/lifecycle.integration.test.ts` | Add regression coverage for real startup/readiness and SIGTERM/SIGINT shutdown. |
| `server/src/tests/security.test.ts` | Add regression coverage for signature, MIME, payload and rate boundaries. |
| `server/src/tests/session.test.ts` | Add regression coverage for identity issuance, renewal, expiry/revocation and transitions. |
| `server/src/tests/upload-recovery.test.ts` | Add regression coverage for write-ahead upload recovery and owner-scoped cleanup. |
| `server/src/utils/logger.ts` | Emit structured timestamp/severity/operation records without private payloads. |
| `server/tsconfig.json` | Exclude test sources from deployable backend output. |
| `server/vitest.config.ts` | Prevent compiled/source duplicate test execution. |

# 4. Database Changes

`docs/supabase-migration-v11.sql` is transactional. Apply after any missing v2–v10 migrations; a clean installation uses the full base schema then v11.

- `anonymous_sessions`: unique random identity, hashed access/refresh credentials, short access expiry, absolute session expiry and revocation.
- `media_uploads`: actual provider ID, path, URL, authenticated uploader/room, metadata and claim state; unique path and bounded size.
- `media_upload_intents`: exact generated path before remote upload, with retry/lease fields.
- `media_cleanup`: durable file-ID-only retries and leases; independent of deleted room/message rows.
- `messages.file_id`: additive; historical values are not guessed from URLs.
- RPCs: atomic join/create/extend/wipe, owner-scoped unused-upload queue, expired-room cleanup, upload-intent leasing and media-job leasing.
- Triggers: validate live membership/expiry/reply scope and authoritative one-use attachment metadata on insertion; persist media deletion information before tombstones, burns, wipes and cascade deletion.
- Application tables remain RLS-enabled; v11 removes permissive public policies and revokes anon/authenticated access to these tables and RPCs. Server service_role retains access. Review any external integrations sharing these tables before applying.
- Locks distinguish durable membership from socket presence. Creator slot reservation prevents legacy or explicitly departed creators from being displaced by an unrelated identity.

No existing rooms/messages are automatically removed by migration. Existing plaintext data stays readable under the normal room rules after a new participant is legitimately admitted. Unsafe legacy ownership is deliberately not adopted. Expired/revoked session metadata is pruned in bounded batches. Indexes support due-job, expiry, pending-upload and exact-path lookups.

# 5. Security Improvements

**Authentication:** 256-bit random opaque tokens are issued by the backend. Only SHA-256 hashes are stored. The access cookie lasts 15 minutes; refresh identity has a 30-day absolute expiry. Production uses Secure, HttpOnly, SameSite=Strict, root-path `__Host-` cookies. The matching Origin is required for browser writes. Renewal requires the refresh token and preserves only a verified identity. A proven current access token can renew without breaking other tabs; supported browsers coordinate bootstrap using Web Locks. Lost/expired credentials produce a new identity, not a takeover of legacy ownership.

**Authorization:** private REST reads and mutations require live persistent membership. Creator management and message edit/delete rules compare the authenticated identity. Socket handshake and each event validate the session; room subscription follows successful database authorization. Explicit leave evicts that identity's room subscriptions across tabs; plain disconnect preserves membership. Revocation through the session endpoint immediately disconnects matching sockets; passive monitoring checks sessions every 15 seconds. In-flight operations and passive-session monitoring are not an instantaneous global revocation guarantee.

**Transport encryption:** the deployment guide requires HTTPS and wss through the separate Nginx site. Certificates have not been issued or tested on a VPS. Backend/provider requests are bounded; production secrets stay server-only. Browser-visible variables contain only the public endpoint.

**End-to-end encryption:** **NOT IMPLEMENTED.** The existing AES-GCM helpers are unused by message and attachment flows. Seven helper tests passed (text/Unicode/empty/large input, wrong keys, tampering, nonce uniqueness, binary round trip). This does not make the application E2EE. Code-only invitations provide no independently authenticated secret exchange. Enabling fragment-secret links would require a usable secret transfer path for code-only joining and an attachment/metadata protocol transition. Per the mission's compatibility exception, existing messaging behavior is preserved rather than deploying a partial protocol. Messages remain plaintext at the backend; ImageKit URLs remain public capability links.

**Retention:** room access is denied on expiry independently of the cleanup sweep. Deletion metadata is durable before database removal. Provider deletion retries are idempotent for 404 and survive restart. Deletion does not retract recipient downloads, browser/CDN copies, or provider backups. Unknown legacy attachments need explicit reconciliation/library review.

# 6. Test Results

Final successful commands and results:

| Command | Result |
|---|---|
| `npm install` / compatible audit updates / final install | Completed; lockfile regenerated from actual available versions |
| `npm ci --cache /tmp/nullchannel-npm-cache --ignore-scripts --fetch-retries=0 --fetch-timeout=30000` | Clean installation passed; application build subsequently passed |
| `npm run typecheck` | Application TypeScript checks passed |
| `npm run lint` | Backend and frontend lint passed |
| `npm run build` | Backend tsc and frontend Vite production build passed |
| `TEST_DATABASE_URL=postgresql://arbabarshad@127.0.0.1:55439/nullchannel_test npm test` | **84 passed: 64 backend, 20 frontend/library; no failures or skips in this run** |
| `npm test` without TEST_DATABASE_URL, after shutting down the disposable database | **72 passed, 12 database tests skipped; no failures** |
| `npm audit --omit=dev --json` | Zero runtime advisories; exit 0 |
| Full dependency audit / final npm ci audit output | Five high development-only entries remain in Tailwind/braces; no published braces patch was available |
| `git diff --check` | Passed |

Database tests apply the base schema, v2–v11 migrations, then repeat v11 on a real disposable PostgreSQL 16 database. They cover private capacity, three simultaneous guests with a creator already present, eight concurrent repeated joins, persistent reconnect/tab membership, departed creator reservation, expired/deleted joins, concurrent one-use extension, membership/expiry/reply guards, one-use upload metadata, cascade queueing, wipe/pin consistency, unusable queued uploads and denied public grants. Default `npm test` skips the twelve database tests when TEST_DATABASE_URL is absent; supply an explicitly disposable local DSN to execute them. Test DSNs are restricted to local `nullchannel_test*` databases. No production DSN or secrets were used.

HTTP/Socket.IO tests run real Express routes and socket transports, with mocked provider/database boundaries. They test spoofed UUIDs, denied private reads, creator-only operations, session cookie issuance/revocation, malformed/oversized multipart uploads, valid uploads, malformed events, event rate limits and multi-tab presence. Cleanup/upload tests exercise durable recovery/retry failure branches. Real source backend subprocesses validate liveness, readiness failure without disclosure, invalid startup configuration and graceful SIGTERM/SIGINT.

Frontend tests cover session bootstrap/deduplication/identity transition, one-shot 401 retry, upload/expired-room failures, socket renewal/cancelled reconnect, history/live ordering and burn/wipe synchronization, plus existing crypto helpers. These are library-level tests, not a full rendered interaction regression suite.

Intermediate failures were corrected: initial sandbox dependency/DB execution restrictions, a type-reference lint issue, Web Locks promise typing, duplicate compiled/source test discovery causing overlapping migrations, and a forwarded-header type mismatch. An attempted nonexistent braces patch was removed after registry resolution failed; only published patched dependencies remain in the lockfile. The in-app browser failed during initialization, so no visual/mobile/animation smoke check is claimed. Live Supabase PostgREST, ImageKit upload/delete, Ubuntu systemd/Nginx syntax, DNS and TLS were not verified against a real staging/VPS environment.

Local regression scope:

| Existing functionality | Evidence / remaining check |
|---|---|
| Anonymous onboarding and refresh | Session library/API renewal and transition tests; real rendered flow deferred |
| Private/group creation and room codes | Server-derived identity creation test; real DB private/group operations; existing NanoID test |
| Private capacity, repeated join, tabs and reconnect | Real PostgreSQL concurrent joins plus real Socket.IO unique-presence and client renewal tests |
| Room sharing | Existing eight-character code/link format preserved; no key-fragment protocol added |
| Real-time text, typing, ordering and duplicates | Existing event flows preserved; schema/rate/transport tests and history/live merge tests |
| Message edits and deletion | Spoofed ownership denied through actual HTTP routes; existing edit window/tombstones preserved |
| Images, voice and files | Existing UI controls and 5/10/15 MiB limits retained; valid upload, MIME/signature, overflow and registry/recovery tests; actual provider/media playback deferred |
| Reactions and pinned messages | Existing controls preserved; reactions restricted to supported UI values; real database wipe/pin consistency tested; full rendered interaction deferred |
| Burn-after-read | Existing reader membership rule retained; durable delete trigger and client snapshot/burn reconciliation tested |
| Extension, expiry, termination and panic wipe | Creator-only HTTP tests, concurrent DB extension, expiry rejection, atomic wipe and cascaded cleanup tests |
| Participant visibility | Membership-gated API, unique online identity transport test and cross-tab eviction implementation |
| Mobile responsiveness, theme, styling and animations | Styles/theme/animation/layout source retained; browser initialization failed, so visual/mobile regression is explicitly unverified |

Required live provider checks (explicitly deferred): apply the migration only to an intentionally selected disposable Supabase environment; start the backend with that project's service-role key and a disposable ImageKit environment; exercise upload/claim/display/delete for images, audio and files; expire/wipe a test room; retry provider deletion and validate the queue drains; confirm account grants, folder paths and delivery URLs; finally test real clients against that staging backend. Do not substitute the existing production environment for these tests without separate authorization.

# 7. Compatibility

No registration/login requirement or intentional design change was introduced. Eight-character room codes and existing URLs remain unchanged. Joining by code still supplies the invitation capability, but viewing content requires a successful authenticated membership. Visitors can see minimal joining metadata, not room IDs, creators, participants or message history.

Legacy localStorage UUIDs cannot be securely verified and are ignored as credentials. They cannot be claimed by presenting their value. Existing ownership cannot silently transfer; users obtain new identities. Legacy private memberships may temporarily occupy capacity and old creators cannot perform creator actions under new sessions. Prefer a release transition after existing ephemeral rooms naturally expire; do not wipe production data automatically. Group invitation links can admit a new authenticated identity under the existing group rules.

For historical media, the old frontend commonly put fileId into file_path, while other records may contain actual paths. Reconciliation defaults to dry-run and checks provider ID, stored URL and the known room folder before adopting a deletion ID. Unknown or already-lost historical identifiers are not guessed. Supported image, voice, PDF/text/CSV/ZIP and Office uploads remain at 5/10/15 MiB limits; generic MIME is inferred only for those known supported extensions and validated. Arbitrary octet-stream/unknown formats are rejected for security.

# 8. Production Environment Variables

| Variable | Purpose | Required | Secret | Behavior |
|---|---|---|---|---|
| NODE_ENV | Secure production runtime | Production setting required | No | development default; production on VPS |
| HOST | Listen interface | No | No | 127.0.0.1 default |
| PORT | Unused backend port | No | No | 5050 default; adapt with Nginx |
| CLIENT_URL | Exact browser origin / CSRF origin | Yes | No | localhost dev; actual HTTPS origin on VPS, no trailing slash |
| SUPABASE_URL | Backend project URL | Yes | No | Disposable staging vs actual production project |
| SUPABASE_SERVICE_ROLE_KEY | Database API authorization | Yes | **Yes** | Backend only |
| IMAGEKIT_PUBLIC_KEY | SDK identifier | Yes | No | Backend configuration |
| IMAGEKIT_PRIVATE_KEY | SDK authorization | Yes | **Yes** | Backend only |
| IMAGEKIT_URL_ENDPOINT | Delivery endpoint | Yes | No | Adapt Nginx CSP if using a custom host |
| CLEANUP_SECRET | Optional external cleanup trigger | No | **Yes** | Unset disables trigger; worker still runs |
| DATABASE_TIMEOUT_MS | Database HTTP deadline | No | No | 15000 default |
| IMAGEKIT_TIMEOUT_MS | Provider HTTP deadline | No | No | 60000 default |
| UPLOAD_CONCURRENCY | Active upload slots | No | No | 2 default, range 1–8 |
| SOCKET_CONNECTION_LIMIT | New connections/network address/min | No | No | 60 default; trusted loopback forwarding |
| SOCKET_JOIN_LIMIT | Joins/identity/min | No | No | 30 default |
| SOCKET_MESSAGE_LIMIT | Sends/identity/min | No | No | 120 default |
| SOCKET_TYPING_LIMIT | Typing/identity/min | No | No | 180 default |
| REST_MUTATION_LIMIT | Message operations/identity/min | No | No | 120 default |
| REST_MANAGEMENT_LIMIT | Room operations/identity/min | No | No | 20 default |
| VITE_API_URL | Public optional API origin | No | No | Empty for same-origin Vite proxy/VPS |
| TEST_DATABASE_URL | Disposable local test DSN | Tests only | **Yes** | Never production |

No new signing secret or client credential storage is needed. The complete environment/setup explanations are in `deployment/DEPLOYMENT.md` and the blank deployment example.

# 9. Deployment Instructions

Use `deployment/DEPLOYMENT.md` for the full reviewed command sequence, including migration/legacy-media prerequisites and independent site installation. The following is an explicit operator outline; replace the example hostname, port, Node executable and paths consistently before use. Check `sudo ss -ltnp`, existing users/services/sites and compatible Node engines first. Do not overwrite an existing site or change global Node used by other applications.

1. Create a new dedicated `nullchannel` service user and a deployment-user-owned `/srv/nullchannel`; clone the reviewed revision there or pull an existing checkout with `git pull --ff-only`. Local unpushed changes must be delivered deliberately; an unchanged remote clone does not contain this patch.
2. `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`; opt into database tests only with a disposable local TEST_DATABASE_URL.
3. Back up and apply missing v2–v10 then v11 using Supabase SQL editor or `psql "$NULLCHANNEL_MIGRATION_DSN" -v ON_ERROR_STOP=1 -f docs/supabase-migration-v11.sql`. A clean install applies `server/supabase/schema.sql` then v11. Never automatically run a destructive production command.
4. `VITE_API_URL= npm run build`. Review legacy media with `cd server && npm run reconcile-media` before optionally running `npm run reconcile-media -- --apply` against the intentionally selected environment. Then `cd /srv/nullchannel && npm prune --omit=dev`.
5. Create `/etc/nullchannel/server.env` from `deployment/server.env.example`, root-owned/group nullchannel/mode 640, fill genuine credentials, and set the exact HTTPS CLIENT_URL and free loopback port.
6. Install/adapt `deployment/nullchannel.service.example` as `/etc/systemd/system/nullchannel.service`, using the actual compatible Node path and `/srv/nullchannel/server` working directory. `sudo systemctl daemon-reload && sudo systemctl enable --now nullchannel`.
7. Verify `curl --fail http://127.0.0.1:CHOSEN_PORT/api/health`, then `/api/health/db`; inspect `sudo journalctl -u nullchannel -n 100 --no-pager`.
8. Install/adapt the separate Nginx example as a new, noncolliding sites-available file, enable only that site, run `sudo nginx -t`, then `sudo systemctl reload nginx`. It supplies SPA fallback, API proxy, WebSocket upgrades, real forwarded headers, 16 MiB proxy body cap, caching and an ImageKit-compatible CSP.
9. After DNS/HTTP validation, use the VPS's existing Certbot or the [official installation instructions](https://certbot.eff.org/instructions?ws=nginx&os=snap). `sudo certbot --nginx -d YOUR_ACTUAL_DOMAIN --redirect`; review the site diff, `sudo nginx -t`, reload, and `sudo certbot renew --dry-run`. The template deliberately references no unissued certificate path. [Official Nginx WebSocket guidance](https://nginx.org/en/docs/http/websocket.html) supports the supplied upgrade configuration.
10. `sudo systemctl restart nullchannel`; verify both health endpoints over the actual HTTPS domain and inspect journald. Complete two/three-user private-room, group, message/media/edit/delete/reaction/pin/burn/extend/expire/wipe/refresh/reconnect and mobile/styling checks before opening public traffic.

Examples and service hardening do not constitute a performed deployment. The repository was not pushed or published.

# 10. Remaining Limitations

- E2EE is intentionally not implemented under the allowed compatibility exception. Text and attachment contents are available to the backend/provider. Public ImageKit URL possession allows access independently of room membership; no private-media confidentiality guarantee is made.
- Five development-only Tailwind/braces advisory entries remain without a published compatible braces fix. Keep dev servers/private build inputs trusted and omit the development toolchain from deployed runtime. A Tailwind major migration requires a separate visual review and was not performed.
- Live provider tests were explicitly deferred by the user because no separate staging environment exists. Production credentials were not used. VPS details were not supplied. Provider integration, target Ubuntu/systemd/Nginx/TLS validation and real multi-user rendered UX remain release gates. The browser connector failed during bootstrap; no screenshot/mobile/animation test is claimed.
- API/socket transport tests use isolated database/provider boundaries; real PostgreSQL tests are separate. This does not prove production account permissions, ImageKit limits or network configuration.
- Legacy identities cannot be safely recovered from public UUIDs. Unknown old media identifiers or metadata already removed before this fix need operator/provider review.
- Single-instance rate limits are intentionally process-local and reset on restart. Membership/capacity and cleanup state remain in PostgreSQL. Multiple backend instances require additional operational coordination beyond this VPS target.
- Private-room membership persists on network disconnect and reserves a creator slot. Deliberate credential loss/revocation can leave a slot occupied until expiry; reclaiming it by trusting a UUID would reintroduce takeover.
- Session revocation through the endpoint is immediate for its sockets; passive DB revocation/expiry monitoring runs every 15 seconds, and already-running authorized operations cannot be retroactively cancelled globally.
- Remote deletion is eventually retried, not an assurance that external caches/backups/recipient copies disappear. Signature checks are format checks, not an antivirus/archive-content scanner.

# 11. Production Readiness Verdict

PASS below refers to the executed local acceptance evidence and the implemented controls, not live provider/VPS certification.

| Area | Verdict | Verified scope |
|---|---|---|
| Authentication | PASS | Server-issued/hash-backed identity, expiry/revocation/renewal and spoofing tests |
| Authorization | PASS | REST/socket application operations, private reads and ownership tests; public media URL limitation disclosed |
| Encryption | NOT IMPLEMENTED | HTTPS configuration prepared; E2EE helpers are not integrated |
| Database | PASS | Real PostgreSQL migration/reapplication, capacity/extension/claim/wipe/grant tests |
| Media handling | PASS | Bounded multipart processing, signatures, authoritative registry, queue/intent recovery tests; live provider unverified |
| Socket.IO | PASS | Real transport auth/validation/rate/presence checks and client reconnect tests |
| Cleanup worker | PASS | Database queue/cascade/lease behavior and retry/partial-failure/overlap tests |
| Production build | PASS | Backend and frontend builds executed successfully |
| Automated tests | PASS | 84 executed tests passed with disposable DB enabled |
| VPS deployment readiness | NOT READY | Preparation complete; actual provider, browser and Ubuntu/Nginx/TLS acceptance remains unverified |
