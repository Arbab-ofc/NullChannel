# NullChannel final voice-calling pre-merge audit

Audit date: 2026-10-08. Worktree: `/private/tmp/NullChannel-voice-calling`. Branch: `feat/webrtc-voice-calling`. Starting feature revision: `a6f40e4a96810e6e3fbbcfb9948ab20fb896bda0`. Verified base: `fbd6deb0edfe56818ba62f1173b009bb11c9c578`.

## 1. Overall audit result

The implemented audio-only private-room feature passes local verification after two targeted client race fixes. The owner independently confirmed real microphone/audio calling between two independent browser sessions. Automated browser media is synthetic; neither result establishes cross-network connectivity. No merge, deployment, production provider operation or VPS access was performed.

## 2. Findings by severity

| Finding | Severity | Disposition |
|---|---|---|
| Cancellation before invite acknowledgment could leave the remote invitation ringing and identity busy until timeout | Medium | Fixed with generation-scoped completion and explicit late-call termination |
| Late invitation failure could incorrectly fail a newer outgoing call | Medium | Fixed with generation-scoped error handling |
| Naturally restored WebRTC connection could leave recovery latched, suppressing another recovery attempt | Medium | Fixed by clearing recovery on connected state |
| Existing shutdown test allowed 10 seconds while application shutdown permits 25 seconds | Low / test reliability | Aligned test deadline to 30 seconds; assertions remain intact |
| Old disposable DB jobs can fill bounded cleanup claim batch during repeated test runs | Low / fixture usage | Fresh test database used; documented requirement; production batch limit preserved |
| README had stale identity, migration, test, hosting and public API configuration guidance | Low | Corrected without changing application behavior |
| Five high dependency advisory entries in development-only Tailwind/braces chain | High advisory severity; build-tool exposure | Retained and documented; production dependency audit is clean |

## 3. Critical issues

No verified critical issue was found in the calling implementation. This statement concerns the reviewed source and executed local tests, not a guarantee against undiscovered vulnerabilities.

## 4. High-priority issues

Full `npm audit --json` returns five high entries: braces, chokidar, fast-glob, micromatch and tailwindcss. They share the development-only braces root advisory, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), which lists no patched version. npm proposes a major Tailwind upgrade. Migrating the established styling stack would exceed a minimal pre-merge fix and needs its own visual compatibility review. No advisory is reported by `npm audit --omit=dev --json`.

Keep builds and development servers isolated, use trusted source/glob inputs, and omit development dependencies from the production runtime installation after building. No audit suppression, forced upgrade or security exception was added.

## 5. Medium/low issues

Both client race defects are fixed and regression-tested. Backend room-lookup errors now have explicit regression coverage proving sanitized failure and release of an already-created call. Shutdown timing and disposable-database reuse are test-environment findings; runtime shutdown and cleanup semantics were not weakened.

## 6. Exact fixes

`VoiceCall.invite` captures the current lifecycle generation. A successful acknowledgment from an obsolete invitation sends `call:end` for that returned ID. An obsolete error cannot fail a newer call. `AudioPeer.connectionChanged` clears its recovery flag on successful connection, permitting later interruptions to initiate bounded recovery again.

Added tests cover late success after cancellation, late failure after another invitation, repeated interruption after natural recovery, and database lookup failure. Chromium incoming/active call controls are measured across all seven requested widths. The shutdown test still checks exit code zero, shutdown completion, readiness behavior and sanitized logs; only its deadline now accommodates the actual 25-second application grace plus scheduling overhead.

## 7. Files modified in this audit

| File | Change |
|---|---|
| `client/src/lib/voice-call.ts` | Scope asynchronous invitation completion to its lifecycle |
| `client/src/lib/webrtc.ts` | Release recovery latch on connection restoration |
| `client/src/tests/voice-call.test.ts` | Three client race/recovery regression tests |
| `server/src/tests/call.integration.test.ts` | Database failure regression and seven-width Chromium assertions |
| `server/src/tests/lifecycle.integration.test.ts` | Correct shutdown test deadline |
| `README.md` | Correct identity, migration, dependency install, test and hosting guidance |
| `docs/VOICE_CALLING.md` | Current verification, fresh database requirement, release prerequisites and rollback |
| `docs/VOICE_CALLING_MANUAL.md` | Current counts and owner-confirmed local audio acceptance |
| `docs/VOICE_CALLING_AUDIT.md` | This report |

No dependency, SQL, provider integration, deployment configuration, global style or backend runtime source changed during this audit.

## 8. Tests executed

Verification used Node 22.18.0, the lockfile installed by `npm ci`, installed Chromium, and PostgreSQL 16 on loopback port 55439. The initial sandboxed install could not write npm's cache; the approved clean install completed successfully.

Executed root commands: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm audit --json`, `npm audit --omit=dev --json`, and `git diff --check`. The standalone shutdown suite was also executed with verbose output.

Full optional verification:

```sh
TEST_DATABASE_URL=postgresql://arbabarshad@127.0.0.1:55439/nullchannel_test_voice_audit_20261008 RUN_WEBRTC_BROWSER=1 npm test
```

That DSN identifies a newly created disposable local database, not a provider account. For reproduction, create your own fresh local database whose name starts with `nullchannel_test`; substitute your local username/port. Never use production credentials.

The documented interactive command was launched with an unused port:

```sh
NULLCHANNEL_MANUAL_PORT=5180 npm run voice:manual
```

Readiness returned `{ready:true,mode:"local-voice-fixture"}`. Ctrl+C stopped it with exit code zero, and no listener remained on 5180. The harness's automated tests additionally verify its session, signaling, isolation and shutdown paths.

## 9. Exact results

| Verification | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Final default backend suite | 87 | 0 | 14 |
| Final default frontend suite | 47 | 0 | 0 |
| Final full backend suite with DB and Chromium | 101 | 0 | 0 |
| Final full frontend suite | 47 | 0 | 0 |
| Standalone startup/shutdown suite | 3 | 0 | 0 |

Final full total: **148 passed, zero failed, zero skipped**, across 18 test files. Default skips are the 12 optional PostgreSQL cases and two optional Chromium cases; all were enabled in the full run.

Earlier expanded attempts are not concealed: one returned 99 passed/1 failed backend test because SIGINT exceeded the old 10-second test deadline; another returned 100 passed/1 failed backend test because a reused test database's old cleanup jobs occupied the bounded claim batch. Frontend execution did not start in those failed root runs. The final fresh-database run passed after the documented corrections. No tests were disabled.

TypeScript checks (server, client and manual fixture), lint, both builds and diff whitespace checks passed. Production client output: CSS 41.12 kB; JavaScript 439.45 kB before gzip. Full dependency audit exits nonzero for the five documented high development advisories. Production-only dependency audit exits zero with no vulnerabilities.

## 10. Backend verification

Real Express and Socket.IO tests cover anonymous cookie sessions, identity spoofing, CSRF refusal, membership-protected reads, creator/message ownership, upload validation, presence and reconnection. PostgreSQL tests execute the base schema and migrations through v11, verify repeatable security migration, atomic private capacity, repeated joins, creator reservation, expired/deleted rooms, concurrent extension, room wipe, message membership/reply constraints, media claims, durable deletion and public-role denial.

Call signaling tests cover private-only eligibility, online peer selection, session expiry/revocation, third-party signaling refusal, tab binding, malformed payloads, replay ordering, busy races, acceptance/rejection, disconnect, room expiry/termination, membership loss, deadlines, candidate/event limits, authorization concurrency and lookup failures.

## 11. Frontend verification

Client tests cover session bootstrap/renewal, credential retries, authorized reconnect, message history/live merge, call transitions, permission error handling, remote audio/playback fallback, mute, timers, candidate buffering, late capture cleanup, peer teardown and listener disposal. Source review confirms the existing chat integration removes only its own shared call/lifecycle listeners. Global CSS/theme/animations are unchanged.

## 12. Voice calling verification

Two Chromium scenarios exercise the actual calling UI and native peer engine with synthetic microphone streams. One uses isolated API/session boundaries; the other follows ordinary name-entry through the manual harness's real anonymous session routes without API interception. Bidirectional received audio is asserted. The original browser scenario also asserts connected DTLS, mute/unmute track state, zero video tracks, ended tracks, closed peers, focus containment and group-room button absence. Unit tests verify timer progression, autoplay recovery and microphone errors. The owner confirmed real local microphone/audio independently.

## 13. Existing feature regression results

| Feature family | Evidence | Limit |
|---|---|---|
| Anonymous identities and access denial | Real session routes, cookie/hash tests, REST/socket fixtures | No live Supabase provider |
| Private/group rooms and membership | SQL and REST/socket fixtures; group call button absent | No full browser room-creation matrix |
| Text persistence, expiry, extension, termination, wipe | PostgreSQL constraints/RPC tests, services and emitter review | Full production user journey not replayed |
| Image/document/voice upload and deletion | Bounded upload/signature tests, provider-boundary mocks, upload recovery and cleanup tests | No live ImageKit upload/delivery/delete |
| Images, document downloads and recorded voice playback | Existing unchanged rendering/recording paths reviewed | Not comprehensively exercised with real provider assets |
| Reconnection, session expiry and revocation | Socket/client lifecycle and authorization tests | Actual production tunnel not contacted |

These distinctions are intentional: passing fixture tests is not proof that production media delivery or physical mobile recording works.

## 14. Mobile responsiveness

Chromium assertions passed at **320, 375, 390, 430, 768, 1024 and 1440 pixels** for document/dialog overflow, incoming Accept/Decline bounds and touch-target heights, active Mute/Hangup bounds and touch-target heights, and keyboard focus. Native dialog focus containment is tested. Safe-area classes and live duration behavior are unit-tested. Incoming and active mobile screenshots were visually inspected. This is viewport emulation, not physical device verification or a full accessibility certification.

## 15. Browser compatibility

Chromium executed successfully. Firefox and WebKit binaries are not installed, so they were not executed. Physical Safari/iOS/Android and real device-specific permission/output behavior remain acceptance checks. Browser feature detection and sanitized microphone errors are implemented; those do not replace browser testing.

## 16. Security assessment

The same authenticated Socket.IO connection remains authoritative; WebSocket-only transport is retained. Packet middleware checks session state, while call operations revalidate live private-room membership, two distinct eligible members, identity/socket ownership and bound peer credentials. No browser-supplied sender or recipient is trusted. Strict payload schemas, 48 KiB SDP bounds, 2048-character candidate bounds, candidate counts, revision caps, event limits and origin validation remain active.

Call code has no audio upload/storage/recording or permanent history path. SDP/ICE exists transiently for routing and is not logged. Production cookies retain HttpOnly, Secure, host-only names and SameSite=Strict; write Origin checks remain unchanged. Call media uses browser DTLS-SRTP; this does not provide independently verified peer identity or full anonymity. Existing chat messages/attachments are not newly made end-to-end encrypted.

A tracked-source pattern scan found zero private PEM, AWS access-key or JWT credential patterns; only example environment files are tracked. No manual harness markers appeared in production bundles. Pattern scanning is not an exhaustive secret-detection guarantee.

## 17. Performance assessment

Signaling performs no VPS encoding or relay. Registry entries have identity locks, expiry/ring/connection/recovery deadlines, finite revisions and bounded candidate bookkeeping. Pending authorization is capped at 64; CALL_MAX_ACTIVE bounds entries; event windows cap retained identities. Client queues, listeners, tracks and peers have explicit teardown paths.

Signaling does perform database authorization lookups and peer-session checks. No maximum concurrent call capacity, event-loop latency or memory ceiling is claimed: a 1-vCPU/2-GB load test was not performed. Choose deployment caps from measured load rather than interpreting the default 1000 registry cap as a capacity guarantee.

## 18. Manual harness isolation

Only the dedicated dev-only Vitest entry selects `server/manual`. Normal app startup has no fixture-mode switch. The launcher refuses NODE_ENV=production; fixtures require the dedicated marker and NODE_ENV=test. Provider modules are mocked before imports; inherited provider/DSN/frontend configuration is stripped; .env loading is disabled. Both listeners bind 127.0.0.1, frontend API traffic is local, external STUN is disabled, uploads are explicitly unavailable, and rows are in memory. Actual session issuance, hashing, renewal/revocation, origin checks, membership services and authenticated Socket.IO remain exercised. Production builds exclude the fixture and runtime-only installations cannot run its dev dependencies.

## 19. Known limitations

Local host-candidate success does not prove NAT traversal. No TURN, cross-network test, live provider staging account, physical mobile matrix or multi-instance registry exists. Calls intentionally end on Socket.IO loss, refresh or backend restart; users initiate a fresh call after reauthentication/rejoin. Ring invitations check at most eight eligible peer tabs. ICE revisions are finite (five) and candidates are finite across the call. Microphone permission promises cannot be cancelled, but late call streams are stopped after cancellation. Browser/OS controls output routing and autoplay.

## 20. Deployment risks

No deployment occurred. A future release needs exact HTTPS origin, functioning WebSocket tunnel/proxy, compatible CSP and same-origin microphone permission. Cloudflare Tunnel does not provide a WebRTC UDP relay. STUN is not a relay; restrictive firewalls/NAT may require a real TURN service with short-lived credentials. Peer addresses may be exposed to the other participant. Existing public ImageKit URLs and plaintext message storage remain baseline limitations, not new call guarantees.

## 21. Rollback considerations

There is no call database migration or persisted call state to undo. Restore matching known-good frontend/backend artifacts using an approved isolated release procedure. Preserve the subsequent production WebSocket-only client correction: the raw fbd6deb frontend would retry incompatible polling. Replacing the backend ends active calls. Do not reset protected history, delete production data or execute rollback/deployment operations during this audit.

## 22. Git status

Initial worktree was clean and exclusively on feat/webrtc-voice-calling. Only the nine audited files above were changed. Unrelated original-checkout work was preserved. No empty commit, squash, history rewrite, force push, merge or PR operation is part of this audit. The final response records post-commit cleanliness and remote synchronization.

## 23. Final commit

The audit fixes and this report are recorded in the commit containing this document; its exact immutable hash is supplied in the completion response and verified against the remote branch. This avoids embedding a self-referential commit hash in its own contents.

## 24. Push safety

Only feat/webrtc-voice-calling is authorized for push. The repository has no GitHub Actions workflow; its Vercel file contains build/static rewrite settings. The owner previously confirmed feature-branch pushes do not deploy production. The final response records actual push/remote verification. Protected hashes verified before push: main `a7bece372df1fda2dd7290dc081470e575681005`; fix/production-readiness `fbd6deb0edfe56818ba62f1173b009bb11c9c578`.

## 25. Comparison against production-readiness

The feature starts from verified production-readiness fbd6deb and adds authenticated call signaling, browser audio engine/state/UI, the required WebSocket transport correction, configuration defaults, dev-only fixtures/tests and documentation. Existing provider services, REST controllers/routes, database migrations, security middleware, global styles and deployment configurations remain identical to that branch. This audit changes only two client runtime methods plus tests/documentation. There is no technology replacement or new paid service.

## Verdict

**READY WITH DOCUMENTED LIMITATIONS**

Local functional, authorization, lifecycle, browser-media, database and build evidence supports merge review. The two verified call races are fixed. Unpatched build-only advisories, cross-browser/device coverage, live-provider regression, cross-network connectivity and load capacity remain clearly bounded limitations. This verdict is not permission to merge or deploy; explicit owner approval is still required.
