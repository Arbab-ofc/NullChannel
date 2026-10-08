# Private-room voice calling

This feature adds native browser WebRTC audio to exactly two authenticated members of an existing private room. No camera, screen sharing, recording, permanent call history, audio upload or database migration is added. Group rooms have no call button and the server rejects calls from them.

## Architecture

```mermaid
sequenceDiagram
    participant A as Caller browser
    participant S as Existing authenticated Socket.IO server
    participant B as Callee browser
    A->>S: call:invite (room code)
    S->>S: Validate live private room, membership, sessions, online peer, busy locks
    S->>B: call:incoming
    B->>B: Explicit Accept; request microphone
    B->>S: call:accept
    S->>A: call:accepted
    A->>A: Request microphone; create audio peer
    A->>S: call:offer
    S->>B: call:offer
    B->>S: call:answer
    S->>A: call:answer
    A->>S: Trickle ICE
    S->>B: Trickle ICE
    B->>S: Trickle ICE
    S->>A: Trickle ICE
    A<<->>B: Encrypted DTLS-SRTP audio; server never handles raw audio
    B->>S: call:end
    S->>A: call:ended
    A->>A: Close peer and stop tracks
    B->>B: Close peer and stop tracks
```

The existing Socket.IO server, origin policy, session verification and room membership remain authoritative. The production-compatible client uses WebSocket transport only; polling is not attempted. Native peer connections carry audio directly when ICE finds a viable route. The VPS handles signaling, not media encoding or relay.

The caller is the sole offerer, including ICE restarts. SDP/candidates carry a bounded revision number; answers must match an outstanding offer. ICE is queued until the corresponding remote description is set and local candidates wait for the description acknowledgment. Calls are bound to identities and participating socket IDs. All eligible callee tabs can receive the invitation (at most eight tabs are checked/rung); the first acceptance owns it and other callee tabs dismiss it.

## User interface

Private-room headers show a phone button only when the user has joined. Availability requires the other member to be online. The button is disabled while the identity's current tab is calling or while a voice message is recording/uploading. Server-side busy locks also protect other tabs and rooms.

The incoming native dialog names the caller and room, traps keyboard focus, and provides Accept/Decline. No microphone is requested for notification or rejection. Acceptance requests processed audio with video explicitly disabled. Outgoing users acquire their microphone only after the invitation is accepted. A pending permission prompt can be cancelled; a stream returned later is immediately stopped.

Active calls show status, participant, duration, mute and hangup. Autoplay denial presents a "Tap to enable audio" action. Default output follows the browser/OS; device-change events retry playback. There is no assumption that programmatic speaker selection is supported. Incoming calls close the existing channel menu/extension dialog. Voice message recording is unavailable during a call; text and attachment messaging remain usable.

The controls reuse the existing Button, colors and panel styles. They have visible keyboard focus, explicit accessible labels, minimum 44/48px touch targets, wrapping, bounded scrolling and safe-area bottom padding. No global theme/layout/CSS change is made.

## Configuration

No required credential or provider is added. Existing backend environment and production microphone permission policy continue to apply. Defaults work without TURN infrastructure.

| Variable | Scope | Default | Validation / purpose |
|---|---|---|---|
| VITE_WEBRTC_STUN_URLS | Public frontend build value | stun:stun.l.google.com:19302 | Comma-separated stun:/stuns: host URLs, up to eight; empty uses host candidates only. No username/password/TURN credentials accepted. |
| CALL_RING_TIMEOUT_MS | Backend | 30000 | 1000–60000; no-answer/missed-call timeout |
| CALL_CONNECT_TIMEOUT_MS | Backend | 20000 | 1000–60000; accepted call connection deadline |
| CALL_DISCONNECT_GRACE_MS | Backend | 10000 | 1000–30000; ICE recovery grace |
| CALL_INVITE_LIMIT | Backend | 6 | 1–30 invitation events per authenticated identity/minute |
| CALL_SIGNAL_LIMIT | Backend | 300 | 1–1000 events per event type/identity/minute; total calling packets limited to twice this before session DB access |
| CALL_MAX_CANDIDATES | Backend | 256 | 16–512 candidates per participant for the entire call, across revisions |
| CALL_MAX_ACTIVE | Backend | 1000 | 1–10000 simultaneous registry entries; choose a smaller cap if required by load testing |

The server supplies timeout settings in the invitation/outgoing event so both browser engines use the configured deadlines. Frontend queues independently cap candidates at 256. Unsupported/invalid frontend STUN configuration produces an actionable calling failure rather than crashing chat.

For local development, use Node 22.12+ (verification used 22.18.0), `npm ci`, and the existing `npm run dev`. Use deliberately selected disposable provider credentials for general app development; no production credentials are necessary for the automated call tests. Microphone access requires HTTPS or a browser-trusted localhost origin. A non-loopback HTTP LAN address usually cannot access the microphone.

## Signaling contract

Every request supports a Socket.IO acknowledgment `{ ok: true, callId? }` or `{ ok: false, code, message }`. Malformed/unauthorized requests never relay their payload.

| Request | Payload | Response/event |
|---|---|---|
| call:invite | roomCode | call:outgoing to caller, call:incoming to eligible callee tabs |
| call:accept | callId | call:accepted to both bound peers; answered-elsewhere to other callee tabs |
| call:reject | callId | call:rejected to peers |
| call:offer | callId, revision, sdp | Only caller → bound callee |
| call:answer | callId, revision, sdp | Only callee → bound caller |
| call:ice-candidate | callId, revision, candidate | Only bound other peer |
| call:connected | callId | Marks each authenticated side ready; clears connection deadline after both report |
| call:reconnecting | callId | Initiates one grace deadline and notifies both; repeated recovery reports are safe |
| call:end | callId | call:ended; repeated termination of an already removed call is safe |

`call:timeout` communicates no-answer; `call:error` and `call:busy` provide sanitized failures. SDP is limited to 48 KiB and permits one encrypted audio media section only. ICE text is limited to 2048 characters; fields, index, revision and IDs are validated with strict Zod objects. Only revisions 1–5 are permitted. Unknown call events fail the existing packet whitelist. Sender/recipient/socket IDs submitted by a client are never identity evidence.

## Security and lifecycle

Each packet retains existing session expiry/revocation checks. Each operation rechecks live private-room membership. Target socket/session binding is checked; recipient sessions are verified before ringing, and bound peer sessions are verified during signaling. Exactly two distinct active members are required. Both identity locks are acquired synchronously after asynchronous validation, preventing crossing invitations from creating two calls. Outstanding authorization work is capped at 64; maps/candidate queues and lifetime timers are bounded.

Room expiry has its own exact deadline, independently of the scheduled cleanup worker. Room extension updates that deadline. Termination and membership revocation release calls through existing emitter hooks. Socket loss/session disconnection, pagehide, navigation, React unmount, timeout, microphone loss, negotiation failure and hangup all close local resources. Microphone promises cannot be cancelled by the browser API, but their eventual streams are stopped when the call is already closed.

A WebRTC connection loss tries a deterministic caller ICE restart within the grace window. A Socket.IO disconnect ends the call immediately: after chat reconnects/rejoins, users intentionally start a new call. Calls are not automatically resumed after refresh or backend restart. No call data survives the process. This is a single-instance design; multi-instance deployment needs coordinated call locks, routing and lifecycle state.

## Privacy and network limits

WebRTC audio transport is encrypted with DTLS-SRTP, as implemented by the browser. This is not a claim of cryptographically verified peer identity or full anonymity: signaling passes through the authenticated application server, which is trusted for routing. Peer-to-peer negotiation can reveal network addresses to the other participant, and the configured STUN provider sees STUN requests. There is no call analytics, recording or persistent audio/call storage. SDP, candidates, audio, microphone details and credentials are not logged.

STUN does not relay media. Symmetric NATs, enterprise/mobile firewalls and blocked UDP can prevent calls. The UI reports this on connection/grace timeout. Cloudflare Tunnel proxies signaling but does not supply arbitrary WebRTC UDP relay service. Restricted inbound networking on the VPS is compatible with direct browser-to-browser media; it does not guarantee those browsers can reach one another.

TURN is intentionally not implemented. No paid service, fake relay, static TURN credential or additional VPS UDP port is required. Stronger peer-IP privacy and restrictive-network reliability require a genuine relay later, preferably via an authenticated short-lived credential endpoint and a relay-only option. Permanent TURN secrets must never be placed in VITE variables or bundles.

References: [MDN WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity), [MDN ICE restart](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce).

## Verification

Standard checks:

```sh
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

Browser dependencies are development-only. Install the matching local browser once:

```sh
npm exec --workspace server -- playwright install chromium
RUN_WEBRTC_BROWSER=1 npm test
```

The browser test binds only loopback ports: Vite 5178 and an ephemeral signaling port. It creates two separate Chromium contexts with independently authenticated cookie identities, using isolated database/session/API fixtures and **synthetic** microphone devices. Real getUserMedia streams, RTCPeerConnections, SDP, ICE, DTLS state, bidirectional inbound audio byte counters, mute/unmute and ended track/peer states are asserted. It verifies the incoming dialog, no capture before acceptance, keyboard focus containment, mobile overflow and active application CSS, plus group-room button absence. Screenshots are written to ignored `output/playwright/`. No production database, ImageKit account or website is used. Local media testing uses host candidates without contacting a STUN provider.

The existing database suite can be enabled separately or alongside the browser test:

```sh
TEST_DATABASE_URL=postgresql://LOCAL_TEST_USER@127.0.0.1:LOCAL_TEST_PORT/nullchannel_test RUN_WEBRTC_BROWSER=1 npm test
```

Replace LOCAL_TEST_USER/PORT with a deliberately created disposable local PostgreSQL instance. The suite validates local host/test database names. Never supply a production DSN. The feature adds no schema migration.

The full verified run passed 138 tests: 94 backend (including 12 real PostgreSQL tests and one real Chromium test) and 44 frontend. Physical microphone/speaker quality, actual iOS/Android/Safari/Firefox, cross-network NAT traversal, TURN and live Cloudflare/provider integration remain manual acceptance checks. Chromium viewport emulation is mobile layout evidence, not proof on physical mobile devices.

## Release isolation

Development is isolated on feat/webrtc-voice-calling from fbd6deb0edfe56818ba62f1173b009bb11c9c578. No main/production-readiness commit, merge, force push or live deployment is authorized. Repository automation was inspected: no .github workflow exists, and vercel.json has build settings only. The owner confirmed feature-branch pushes do not deploy production. The current VPS services, filesystem, database credentials, Nginx and Cloudflare Tunnel were not accessed or modified.

## Interactive local testing

Run `npm run voice:manual` for real microphone/audio calls between separate Chrome profiles, with disposable in-memory data and no provider credentials. See [exact browser steps and fixture isolation](VOICE_CALLING_MANUAL.md).
