# Local interactive voice testing

From the **feat/webrtc-voice-calling** worktree, with Node 22.12+ and dependencies installed (`npm ci`), launch:

```sh
npm run voice:manual
```

No Supabase/ImageKit account, environment file, migration, external STUN server or Playwright browser installation is needed for interactive use. Use your ordinary Chrome installation and real microphone/speakers.

Open **http://127.0.0.1:5178/chat/TEST1234**. Use this exact hostname; do not substitute localhost, a LAN address or the production domain. Both callers use the same URL.

1. Open the URL in a normal Chrome window. Enter **Alice** and click **Continue**.
2. Open an **Incognito** Chrome window (or a different Chrome profile) and visit the same URL. Enter **Bob** and click **Continue**.
3. Confirm both windows show two online participants. Alice's phone button becomes available after Bob joins.
4. Alice clicks the phone button. Bob receives the actual **Incoming Voice Call** dialog with Alice's name and the room name.
5. Bob clicks **Accept**. Allow microphone access in both windows when requested. Camera permission is never requested.
6. Wait for **Voice Call Connected**. Speak into the microphone and confirm sound through the other window. Use **Tap to enable audio** if the browser blocks autoplay. The call duration should advance.
7. Alice clicks **Mute**; verify the other side no longer hears Alice. Click **Unmute** and verify sound returns. Repeat on Bob's side if desired.
8. Either caller clicks **End voice call**. Both windows show **Call ended**, and the microphone indicator should clear. Dismiss the status to start another call.
9. Start another invitation and click **Decline** on Bob's side. Neither side should request microphone permission for the rejected invitation. Start another call to verify locks were released.
10. Optionally ignore an invitation for 30 seconds: Alice sees **No Answer**, Bob sees **Missed Call**. Reload/close a participating tab during a connected call to check safe termination and subsequent rejoining.
11. Press **Ctrl+C** in the launch terminal when finished. All disposable data and sessions disappear when the process exits. Restarting provides a fresh room; old cookies are replaced by fresh credentials when the app initializes.

**Two normal windows in the same Chrome profile share cookies and represent one user.** Use separate profiles or normal + Incognito. Two Incognito windows generally share the same Incognito cookie context, so they do not represent two users either. The first new browser identity becomes the fixture room creator; the second joins normally. Third identities cannot bypass the private-room capacity.

On one computer, both callers may use the same physical microphone and output device. Use headphones, lower output volume, and avoid acoustic feedback. Some devices/drivers prohibit simultaneous microphone capture; a NotReadableError is then an actual device limitation. This loopback-only environment cannot be used from a second physical computer over the LAN. It is meant to exercise real devices on one development machine; cross-network and physical mobile testing need a separately designed HTTPS test deployment.

Chrome treats loopback HTTP origins as trustworthy for microphone access. If access is denied, reset this site's microphone permission in Chrome and verify the OS allows Chrome to use the microphone. Native WebRTC and autoplay behavior remain unchanged; the harness never substitutes synthetic media or forces permissions for interactive use. See [getUserMedia requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## Port conflicts

The launcher binds only 127.0.0.1 and fails rather than taking over an occupied port. Stop your previous harness or choose another unused port:

```sh
NULLCHANNEL_MANUAL_PORT=5180 npm run voice:manual
```

Use the exact URL printed by that run in both browser contexts. The default single command remains `npm run voice:manual`. Ctrl+C shutdown uses a per-process nonce so it cannot stop another harness that happens to occupy the requested port.

## What is real and what is isolated

The harness serves the unmodified React ChatPage, useVoiceCall hook, AudioPeer engine, call UI, authenticated Socket.IO server, room socket handlers, call registry, real session routes, token hashing, renewal/revocation, origin checks, rate limits and room membership services. Calls use actual browser microphone input and audio playback.

Only the Supabase/ImageKit module boundaries are replaced by Vitest-local fixtures, following the existing Chromium integration-test architecture. The small in-memory adapter stores anonymous sessions, the fixture private room, memberships and local text messages. It supports the data operations needed for calling; it is not a full PostgreSQL emulator. Session rows are capped at 32 and messages at 500. Restart the harness to clear them.

Media upload/provider operations are explicitly disabled. General room creation and unsupported database operations are outside this fixture's scope; use the prepared TEST1234 room. This is not a replacement development backend for every application feature. Ordinary application execution is unaffected.

The launcher strips inherited Supabase, ImageKit, VITE, database/test-DSN and cleanup credentials from its child. It does not load .env files. Vite is configured with envDir=false, a blank API origin and host-only ICE configuration. Browser APIs stay on the local origin; server providers are mocked before import. No production database, ImageKit endpoint, website or VPS is contacted.

The harness files are under server/manual, outside the production TypeScript build. They are selected only by a dedicated Vitest configuration and are not imported by server/src production code. No production authentication bypass or test-mode flag was added to the application. The launcher refuses NODE_ENV=production, and fixture loading requires NODE_ENV=test plus its dedicated launch marker. Production runtime installations that omit development dependencies cannot run this Vitest harness.

## Automated verification

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

The new automated suite launches the documented command on a separate loopback port, checks real session cookies/renewal/revocation, origin protection, authenticated invitations, rejection, disabled uploads, memory capacity and production-mode refusal. It stops its own launcher after testing.

Stop the interactive harness with Ctrl+C before running the full Chromium suite, because the existing browser test also uses port 5178. The new harness regression tests use port 5179.

To include real Chromium synthetic-audio checks, using the existing test browser installation:

```sh
RUN_WEBRTC_BROWSER=1 npm test
```

That test follows the same UI entry flow through the running manual harness without intercepting its API responses. Synthetic microphone flags belong only to automated browser tests. They are never passed to your ordinary Chrome windows or the interactive command. Human microphone/speaker quality must be checked manually using the steps above.

Final pre-merge full-suite result: **148 passed** (101 backend, 47 frontend), with both Chromium scenarios and the 12 disposable PostgreSQL tests enabled. TypeScript checks (including the manual harness), lint and both production builds passed. Real human microphone/speaker quality was not asserted by automation.

The owner also confirmed successful real microphone/audio calling between two independent sessions. This is human local acceptance evidence; it does not establish cross-network connectivity. The final audit separately records automated evidence and untested providers/browsers/devices: [VOICE_CALLING_AUDIT.md](VOICE_CALLING_AUDIT.md).
