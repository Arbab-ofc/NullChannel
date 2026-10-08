# V12 production migration audit

## Decision

**GO for the documented coordinated v11 → v12 release. NO-GO for a mixed-version/rolling backend release or an unchanged old frontend Burn Mode.** This is code/local-database approval, not permission to deploy and not verification of the live production schema. An operator must confirm production matches canonical v11, back up, perform the paired release and require existing tabs to reload. No production provider, VPS, secret, remote push or deployment was used in this audit.

## Findings and local fixes

- **High: stale-client viewing semantics.** Pre-v12 clients automatically acknowledge delivery after 1.4 seconds and immediately remove their local copy on a successful response. Accepting those receipts would start a deadline without genuine viewport viewing. The REST schema now requires `viewProtocol: "focused-viewport-v1"`; the new viewing hook sends it. Old receipts receive 409 `CLIENT_UPGRADE_REQUIRED` before any deadline is recorded. This is protocol identification, not proof of human attention. Other existing messaging/calling interfaces remain unchanged; old Burn Mode requires reload. An authorized recipient can still intentionally submit a viewing acknowledgement.
- **Medium: unbounded migration lock wait.** V12 now sets transaction-local `lock_timeout=5s` and `statement_timeout=60s`. Failure aborts and rolls back. DDL validates a CHECK and builds a regular index, so it can lock/scan the messages table. This is a maintenance-window migration, not a zero-lock online migration. Large tables may need an operator-reviewed longer statement timeout; never bypass a timeout by blindly disabling checks.
- **Medium: API schema-cache rollout risk.** The migration now transactionally sends `NOTIFY pgrst, 'reload schema'` on commit, so new columns/RPCs are announced to PostgREST without relying on a preinstalled DDL event trigger. Local LISTEN/NOTIFY delivery is tested; actual Supabase cache reload remains a deployment smoke check. This follows [official PostgREST schema-cache documentation](https://docs.postgrest.org/en/stable/references/schema_cache.html).
- **Defense in depth:** Both SECURITY DEFINER functions use `search_path=pg_catalog,pg_temp`, with application tables/types explicitly `public` qualified. The receipt rechecks short-lived access expiry as well as absolute session expiry and revocation. Session and membership share locks serialize receipt commit with revocation/explicit leave. Missing/disabled or incorrectly shaped canonical v11 insert/media triggers cause migration failure before DDL. After revocation/grant statements, inherited public-role EXECUTE permissions are checked and cause rollback if unsafe.

## Required checks

| Check | Result and evidence |
| --- | --- |
| 1. Canonical v11 compatibility | PASS. Reviewed base schema and v2–v11; tested upgrade of populated v11 and the full clean-install chain. The live production schema was not inspected. |
| 2. Existing rooms/messages preserved | PASS. JSON snapshots including old columns, legacy IDs/unknown media paths, tombstones, memberships, reactions and pins match before/after migration and replay. |
| 3. No migration-time destructive data operations | PASS. Only additive columns, constraint/index, function definitions and ACL checks/changes execute. DELETE statements are inside defined cleanup functions, not invoked by migration. |
| 4. CHECK safe for existing v11 rows | PASS. Both new columns are nullable with no non-null backfill; all existing rows satisfy the null/null branch. V10 guarantees a non-null burn flag. Invalid partial/deadline pairs are rejected; previously drifted partial-v12 data may deliberately fail and roll back rather than be rewritten. |
| 5. SECURITY DEFINER abuse resistance | PASS within the server-only service-role trust boundary. PUBLIC/anon/authenticated execution is revoked; inherited permissions fail closed; qualified objects and pg_catalog-first resolution defeat temporary shadowing. A leaked service-role key or privileged DB owner remains outside this guarantee. |
| 6. Identity derived from authentication | PASS. Express hashes/verifies the access cookie, stores `res.locals.identity`, overwrites compatibility sender fields and passes that verified identity to the RPC. Spoofed sender and client timestamp tests pass. There is **no Socket.IO read-receipt handler**; invented socket receipts are rejected by the existing event allowlist. Socket messaging retains per-packet session checks and derived identity. |
| 7. Repeated receipts do not reset deadlines | PASS. Room/message locks and update-only-if-null preserve the first DB timestamp; eight simultaneous receipts return one deadline exactly 60 seconds later. |
| 8. Concurrent workers race-safe | PASS. Room-before-message locks, SKIP LOCKED and 50-room/500-message bounds. Eight workers returned each due ID once. A cleanup/wipe race and repeated execution succeeded. Locks release on commit/rollback; process-local overlap prevention also remains. |
| 9. Media deletion reliably queued | PASS for actual stored file IDs. The v11 BEFORE DELETE/UPDATE trigger queues in the same transaction; injected queue failure rolls back deletion, and retry queues once. Known IDs are not inferred from URLs. Legacy attachments with null/unknown IDs remain a pre-existing limitation: their provider deletion cannot be guaranteed without reconciliation. |
| 10. Existing-client rollout | CONDITIONAL. General interfaces remain; stale burn receipts fail closed with 409. Serve matching frontend/backend and require reload. Do not promise seamless old-client Burn Mode compatibility. |
| 11. Old cleanup behavior | PASS for v11 room/media workers. Tests show unseen and not-yet-due burn messages in live rooms survive those RPCs. Room expiry/wipe intentionally override burn delay. **Old backend receipt handlers still immediately delete**: stop every old instance before releasing v12. |
| 12. One-transaction safety | PASS. BEGIN/COMMIT, ordinary transactional CREATE INDEX, no concurrent-index command. Injected late failure left no new columns, index or functions and preserved all rows. Inherited role-grant failure also rolled back. |
| 13. Rollback | Documented below. Failure before commit needs no data repair. After commit, retain additive schema; old code changes burn timing and is not a privacy-equivalent rollback. |
| 14. Secrets | PASS for this change/audit. Only loopback test DSNs and synthetic fixtures were used. No .env/provider credential changes; no credentials, private message content or tokens added to logs. |
| 15. Deployment order | Explicit below and in UX_POLISH.md. V12 schema must exist before new backend queries request its fields. |

## Verification executed

Node 22.18.0, local PostgreSQL 16, actual Express/Socket.IO fixtures and Chromium. Two independent empty disposable local databases isolate the migration audit from the ordinary PostgreSQL suite.

```sh
# Set PATH to your Node 22 and PostgreSQL tools. Create fresh empty databases first.
# These are local fixture DSNs, not production credentials.
TEST_MIGRATION_DATABASE_URL=postgresql://127.0.0.1:55439/nullchannel_test_v12_notify_verified_20261009 \
TEST_DATABASE_URL=postgresql://127.0.0.1:55439/nullchannel_test_v12_complete_verified_20261009 \
RUN_WEBRTC_BROWSER=1 npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Final full suite: **122 backend + 56 frontend = 178 passed; 0 failed; 0 skipped.** Backend includes 11 new populated-v11 migration audit tests and 15 existing PostgreSQL tests, plus authenticated REST/socket and real Chromium regressions. Earlier focused receipt/migration verification passed 26 tests. The added notification check exposed a rollback-test injector matching a comment instead of the COMMIT statement; the injector was corrected to match an entire statement line, with no test disabled. TypeScript, ESLint and both production builds passed. No live ImageKit upload/deletion or Supabase PostgREST integration was executed. Database fixture timestamps are advanced for deadline expiry; no production process or real 60-second wall-clock retention guarantee is claimed.

`TEST_MIGRATION_DATABASE_URL` is tests-only. It must identify a **separate empty loopback database** named `nullchannel_test...`; populated databases and the same DSN as `TEST_DATABASE_URL` are rejected. Choose fresh names for each audit replay. The harness never resets existing data. Without the optional DSNs/browser flag, those cases are reported skipped.

## Deployment order (instructions only; not executed)

1. Record the deployed commit/environment and back up the database and matching frontend/backend artifacts. Confirm canonical v11, enabled origin-mode `guard_message_insert` and `queue_message_media`, service-only table access and trusted migration owner. Inventory unknown legacy attachment IDs separately. Prepare and validate Node 22 release artifacts outside production before the short release window.
2. Stop **all old NullChannel backend/cleanup instances only**. Keep other VPS applications, Nginx and cloudflared running. Do not apply a rolling backend update: old receipt handlers bypass the new burn delay even after v12 is installed.
3. With a protected owner PostgreSQL connection, apply only `docs/supabase-migration-v12.sql` using `psql -v ON_ERROR_STOP=1 -f ...` (or the SQL editor as one complete script). The file contains its own transaction. Do not split it into independently committed statements. Do not rerun earlier migrations unnecessarily. Wait for the PostgREST schema cache to reload and smoke-test the new fields/RPCs through the backend before opening traffic; `/api/health/db` alone checks connectivity, not v12 metadata readiness. On timeout, missing-trigger or unsafe-grant failure, inspect and resolve the cause before retrying; do not start the new backend against a failed migration.
4. Install the matching new backend **and** compiled frontend, keeping secrets and existing Nginx/WebSocket-only configuration intact. Start only the new NullChannel service. Require existing browser tabs to reload for the explicit viewport receipt protocol; index/SPA HTML should retain the existing no-cache policy and hashed assets their immutable policy.
5. Verify `/api/health`, `/api/health/db`, new backend startup/burn cleanup logs, two-member burn receipt/deletion, unseen retention, history exclusion, media queue retry and ordinary messaging/calling. Confirm no old worker or backend process remains. See UX_POLISH.md for the operator commands for `/srv/nullchannel`, localhost:5050 and systemd `nullchannel`.

## Rollback and limits

- Before migration commit: any failure rolls back all v12 DDL/grants; existing records remain. Fix the reported precondition, or resume the recorded old release if the new release is abandoned. That old release retains its original immediate-burn behavior.
- After commit: retain v12 columns, index and RPCs; do not drop them or clear timestamps. Already scheduled deadlines must remain durable. Prefer a forward fix or a rollback release that retains the v12 burn receipt/worker logic. Restoring a fully old backend is **not** compatible with the 60-second promise: it ignores deadlines and can immediately delete on its old receipt path. If the operator deliberately chooses that rollback, disclose the change in privacy timing and coordinate frontend/backend together. Do not keep old and new workers/backends active concurrently.
- UI-only rollback to a pre-v12 client cannot start new burn deadlines against the guarded backend. Existing deadlines still run on the new worker. Reload/restore the matching UI before reenabling burn use.
- No rollback can reconstruct destroyed messages or deleted attachments. Provider caches/backups and participant copies are outside this feature's erasure guarantees.
- Normal message deletion is about 0–1 second after deadline plus database/worker latency; outages/backlog increase latency. API history, individual reads and replies filter overdue data independently of physical cleanup. Provider deletion remains on the existing minute-scheduled, leased retry queue. Unknown legacy file IDs cannot be safely guessed. NTP/time consistency between VPS and PostgreSQL remains an operational requirement; API availability checks use the trusted server clock against DB deadlines.
- Canonical local schema, permissions and trigger behavior are verified; actual Supabase configuration, production row volume/DDL duration, ImageKit and physical devices remain operator acceptance checks. The service-role credential must remain server-only. The target remains a single backend instance; database cleanup concurrency is safe, but multi-instance Socket.IO event propagation needs shared routing infrastructure.

## Files changed by this audit

- `docs/supabase-migration-v12.sql`: bounded transaction, commit-only PostgREST schema refresh, trigger prerequisites, hardened resolution, live access/session/member locks and inherited-ACL check.
- `server/src/schemas/message.schema.ts`, `server/src/controllers/room.controller.ts`: versioned viewing receipt; legacy 409 response.
- `client/src/hooks/useSeenMessages.ts`, `client/src/tests/seen-messages.test.tsx`: send/test the explicit viewing protocol.
- `server/src/tests/api-socket.integration.test.ts`: authenticated receipt, spoofing/timestamp/origin/session/ownership rejection and socket bypass tests.
- `server/src/tests/migration-v12.integration.test.ts`: populated-v11 preservation, transactional rollback, trigger/ACL prerequisites, shadowing, concurrency, queue failure, old cleanup and bounded batch tests.
- `docs/UX_POLISH.md`, `deployment/DEPLOYMENT.md`, `docs/MIGRATION_V12_AUDIT.md`: rollout, reload, rollback and verification evidence.

All fixes remain local on `feat/nullchannel-ux-polish`; this audit did not push, merge or deploy.
