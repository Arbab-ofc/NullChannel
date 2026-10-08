# UX polish and 60-second post-seen burn

This local branch is `feat/nullchannel-ux-polish`, based on the verified voice-calling commit `852a5d0ab4f69ae79e9f4eee7f715c905136a9fb`. No production configuration, production resources, protected branches or remote branches were changed. No new dependency or environment variable is required.

## Behavior and root causes

The old chat effect ran `scrollIntoView({behavior: 'smooth'})` whenever messages, notices **or typing** changed. That moved an ancestor/page as well as the transcript and continually interrupted people reading history. The typing line also appeared inside the transcript, changing its height. Typing updates created fresh state objects even for unchanged names; the room countdown rerendered the whole chat every second.

The transcript now owns its scroll position. Within 80px of bottom it follows incoming messages without repeated smooth animation. Otherwise distinct incoming IDs become unread, while the first surviving visible message stays anchored. ResizeObserver restores that anchor when attachments change height; deletions use the next surviving anchor. An explicit “↓ 3 new messages” button or manual bottom scrolling clears unread and resumes following. Own messages resume following on delivery; server duplicate acknowledgements do not increment counts. Typing has a permanently reserved strip outside the transcript and opacity/transform transitions. The existing 900ms typing emission throttle and disconnect/inactivity cleanup remain. The expiry component owns its countdown, uses tabular digits and a fixed width.

A shared semantic footer on public pages includes NULLCHANNEL, the requested supporting text, dynamic year and Arbab credit. Chat routes omit it. The header has one connection status DOM node, fixed-size call/menu controls and an expiry display. The native modal Command Center groups Appearance, Channel, Navigation and creator-only destructive actions; existing callbacks, confirmations and permissions remain. It traps focus, locks background scrolling, closes on Escape/backdrop, restores focus, handles landscape scrolling and safe-area insets. An incoming call/expiry dialog closes the menu immediately. Motion uses short opacity/transform transitions and respects reduced motion. Chat uses dynamic viewport height; physical mobile keyboard behavior still needs device acceptance testing.

## Authoritative burn protocol

The old frontend reported burn-read 1.4 seconds after delivery/history retrieval; the server deleted immediately. Delivery no longer means seen. A non-sender burn message must be at least half of its visible viewport-sized area in view for one continuous second while the document is foreground and focused. Leaving view, hiding the tab or losing focus cancels the viewing interval. This is an explicit UI viewing definition, not proof a person read the text. A member can intentionally acknowledge viewing; no server can prove human attention.

The existing authenticated, Origin-protected, rate-limited REST receipt derives identity from the verified cookie. Membership and room/message association are checked in the controller and again transactionally in `mark_message_seen`. PostgreSQL locks the room then message, verifies the live session and recipient, and records `first_seen_at = clock_timestamp()` and `burn_expires_at = first_seen_at + 60 seconds` only once. The browser supplies no timing or ownership value. In group rooms the first valid non-sender recipient starts the shared deadline. Repeated receipts, multiple tabs, reconnection, editing and client clock changes do not extend it. Unseen burn messages survive until viewed, explicit deletion/wipe or room expiry.

A non-overlapping worker runs at startup and every second. Its RPC locks bounded batches with SKIP LOCKED, physically deletes due messages and triggers the existing durable ImageKit cleanup queue before deletion. It emits existing `message-burned` events after commit. Clients remove those IDs and quoted previews and reject delayed delivery of removed IDs. Normal deadline-to-message-deletion latency is approximately 0–1 second plus database/worker latency. This is not a hard real-time physical deletion guarantee: outages/backlog delay deletion. History, individual lookups and quoted replies filter overdue deadlines so reconnects do not expose them while cleanup is delayed. A currently disconnected client can retain already downloaded content until it reconnects; this feature cannot erase participant copies.

Room expiration and panic wipe retain independent immediate access revocation/deletion. Attachment **provider** deletion remains asynchronous in the existing minute-scheduled leased queue with retries. It is not guaranteed at exactly 60 seconds, and public provider URLs/caches/backups retain their existing limitations. Neither messaging E2EE nor stronger provider retention guarantees are introduced. WebRTC still uses authenticated signaling, audio-only encrypted WebRTC transport and no audio storage.

## Migration

Apply `docs/supabase-migration-v12.sql` after v11 and before starting this backend. It adds nullable UTC timestamps, a strict paired/exact-60-second constraint, a partial due index and two service-role-only RPCs. Existing rows retain null deadlines; existing ownership is unchanged. A clean database requires the base schema plus v2–v12 in order. No production database was accessed. Disposable PostgreSQL tests exercised the complete migration chain, concurrent receipts, authorization, persistent timestamps across connections, due deletion, queueing and repeated cleanup.

## Verification

Node 22.18.0 was used. Executed `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`, standard tests, and expanded tests with a fresh loopback-only `TEST_DATABASE_URL` plus `RUN_WEBRTC_BROWSER=1`. Expanded verification passed 107 backend and 56 frontend tests (163 total, zero failures/skips). The last browser-enabled rerun without a database DSN passed 92 backend + 56 frontend tests and intentionally skipped the 15 database cases already verified separately. TypeScript, ESLint, both builds and `git diff --check` passed. Earlier test-selector failures were corrected (the application already had a composer footer and the new closed menu dialog); no failing test was disabled.

Tests cover bottom-follow, preservation while reading, three-message unread counts/deduplication, explicit/manual clearing, image-height and deletion anchoring, own-message follow, focused viewing intervals, visibility cancellation, exact server deadlines, concurrent repeated receipts, sender/nonmember rejection, restart-independent persisted state, recipient departure, overdue filtering and durable file-ID queueing. The database fixture advances timestamps to exercise deadline expiry without a 60-second wall-clock wait; separate database connections verify persistence, rather than restarting the production process.

Real Chromium exercised actual chat hooks/UI and authenticated sockets. It verified transcript/header bounds during rapid typing, unchanged older reading position on three incoming messages, unread-button follow, both themes at 320/375/390/430/768/1024/1280/1440px, no horizontal page overflow, exactly one visible status, visible expiry, 44px voice targets, menu focus containment/Escape/backdrop restoration, public footer responsiveness, then bidirectional synthetic audio, mute/unmute, hangup and resource release. Synthetic browser audio is not a physical microphone/speaker quality test. Firefox, Safari/WebKit, physical devices, cross-network STUN/TURN, and live Supabase/ImageKit behavior were not tested. Existing provider mocks and real local PostgreSQL tests protect regression paths but do not establish live provider delivery. No load-tested maximum call capacity is claimed. Five existing development-only Tailwind/braces audit entries remain; production dependency audit is clean.

## Safe Ubuntu 24.04 / Node 22 release instructions (not executed)

Only deploy after separate approval and staged acceptance. These commands are instructions, not authorization to run them. Keep other VPS applications running; do not change Nginx or Cloudflare for this release. Preserve same-origin API/socket routing and WebSocket-only transport.

1. Review/merge through your approved workflow, then select its actual release commit. Back up the database using your existing protected procedure and record the deployed commit, environment and current compiled frontend. Confirm v11 is installed. Do not put credentials in Git or shell history.
2. Prepare an isolated release checkout outside `/srv/nullchannel`; build with Node 22 and the existing public frontend configuration. Do not copy secrets into the frontend build. For example, replace the commit argument with the actual approved commit:

   ```sh
   git clone https://github.com/Arbab-ofc/NullChannel.git /srv/nullchannel-ux-release
   cd /srv/nullchannel-ux-release
   git checkout --detach APPROVED_RELEASE_COMMIT
   npm ci
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

   `APPROVED_RELEASE_COMMIT` is an operator input, not a known deployment commit. The feature has not been pushed. Standard tests intentionally skip optional local database/browser cases unless configured.
3. Schedule a brief coordinated NullChannel release window. Stop **only** `nullchannel` before migration so the old backend cannot keep immediately consuming burn messages during transition. Leave Nginx, cloudflared and other services running. Load a protected PostgreSQL DSN through your existing secure operator environment and apply v12:

   ```sh
   sudo systemctl stop nullchannel
   psql "$NULLCHANNEL_MIGRATION_DSN" -v ON_ERROR_STOP=1 -f docs/supabase-migration-v12.sql
   ```

4. Install the approved backend and built `client/dist` into the service/static paths currently configured for `/srv/nullchannel`, retaining the protected environment and ownership. Follow your existing backup/release-swap procedure; do not overwrite unrelated files or `.env`. This repository cannot assume your Nginx root or systemd release layout. If using a service-user-owned Git checkout instead, ensure its working tree is clean, fetch and check out the explicit approved release commit, install/build there during the window and preserve rollback artifacts.
5. Start and verify only NullChannel:

   ```sh
   sudo systemctl start nullchannel
   sudo systemctl status nullchannel --no-pager
   curl --fail http://127.0.0.1:5050/api/health
   curl --fail http://127.0.0.1:5050/api/health/db
   sudo journalctl -u nullchannel -n 100 --no-pager
   ```

   Inspect sanitized `burn_cleanup_failed`/media retry logs. Test two independent sessions, scroll/typing, mobile controls, real microphone calls and a burn message seen for 60 seconds. Keep the existing Nginx/Cloudflare configuration untouched.
6. Rollback by stopping only NullChannel and restoring the recorded matching backend/frontend artifacts and prior dependency tree, then starting it. Leave additive v12 columns/RPCs/index in place; do not drop columns or erase user data. **Old code restores the old immediate burn behavior** and ignores scheduled deadlines. A rollback therefore changes privacy timing; communicate it and preferably use a forward fix. No rollback can restore already destroyed messages. Do not promise continued 60-second semantics with the old backend.

## Changed-file inventory

| File | Change |
| --- | --- |
| `client/src/App.tsx` | Shared public footer placement; chat excluded. |
| `client/src/components/common/Footer.tsx` | Themed semantic footer and dynamic copyright. |
| `client/src/pages/ChatPage.tsx` | Stable typing, scoped scroll/unread, real viewing receipts, late-event deletion protection, single status and responsive controls. |
| `client/src/hooks/useTranscriptScroll.ts` | Scroll-controller lifecycle and ResizeObserver cleanup. |
| `client/src/lib/transcript-scroll.ts` | Bottom-follow, unread deduplication and surviving-message anchors. |
| `client/src/hooks/useSeenMessages.ts` | Foreground viewport observation, continuous viewing interval and authorized receipt retries. |
| `client/src/components/chat/ExpiryCountdown.tsx` | Isolated fixed-width countdown. |
| `client/src/hooks/useCountdown.ts` | Immediate initialization before interval ticks. |
| `client/src/components/chat/CommandCenter.tsx` | Accessible modal panel, closing transition, focus and scroll restoration. |
| `client/src/styles/globals.css` | Reserved activity strip, menu/header layout, reduced-motion transitions and transform-based loading bars. |
| `server/src/controllers/room.controller.ts` | Schedule burn through the authenticated atomic receipt instead of immediate deletion. |
| `server/src/services/message.service.ts` | Deadline fields, overdue filtering including replies, and seen RPC. |
| `server/src/services/cleanup.service.ts` | Non-overlapping burn cleanup and existing realtime removal notification. |
| `server/src/server.ts` | One-second startup/background burn worker and graceful shutdown. |
| `docs/supabase-migration-v12.sql` | Additive persistent deadlines, constraint/index and restricted transactional RPCs. |
| `client/src/tests/transcript-scroll.test.ts` | Five scroll/resize/deletion/unread regression tests. |
| `client/src/tests/seen-messages.test.tsx` | Three genuine-viewing and timer stability tests. |
| `client/src/tests/footer.test.tsx` | Semantic copy/year/credit regression. |
| `server/src/tests/burn.test.ts` | Availability, authenticated RPC and worker overlap/error regressions. |
| `server/src/tests/database.integration.test.ts` | Full v12 migration replay, constraints, concurrent deadlines and media queue integration. |
| `server/src/tests/call.integration.test.ts` | Actual Chromium chat, typing, responsive footer/menu and preserved WebRTC regressions. |
| `README.md` | Updated migration requirement and burn-read semantics. |
| `deployment/DEPLOYMENT.md` | Correct migration chain and cleanup cadence. |
| `docs/UX_POLISH.md` | Root causes, protocol, evidence, limitations and coordinated deployment/rollback instructions. |
