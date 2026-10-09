# Responsive UI redesign verification

Implemented locally on `feat/nullchannel-ux-polish`. No deployment, merge, push, provider access, or production changes were performed.

## Layout

The old chat stacked a large desktop action toolbar above the transcript, used increasing outer padding and flex gaps, and showed the context sidebar at tablet widths. Those containers consumed the available message height.

The chat now occupies a single visible viewport using an explicit `minmax(0, 1fr)` grid row and a flexible workspace with `min-height: 0`. The transcript remains the primary scrolling region. Desktop room controls move into the existing independently scrolling context rail at 1280px and above. Mobile and tablet use the full width. The composer remains in normal flex flow, with inline tools at 768px and above. Mobile title and channel ID share a compact row; the connection indicator, voice button and expiry remain visible.

Safe-area padding lives on the viewport shell. CSS uses `100dvh`; a cleaned-up, animation-frame-coalesced VisualViewport hook also handles browsers whose software keyboard resizes the visual viewport independently. Pinch zoom retains browser behavior. The viewport meta enables safe-area coverage and Chromium keyboard resizing.

The existing transcript anchoring and unread controller, read-receipt hook, message actions and typing behavior remain intact. Typing uses a permanently reserved activity region; it cannot change the message area's height. No unconditional scrolling effect was added.

## Footer

The public footer uses a large home-linked wordmark, a restrained cyan radio mark, a clean layered panel surface, separated copyright line, and distinctive Arbab credit. The year is dynamic. All colors and fonts use existing theme tokens. The layout stacks on narrow screens. Active chat routes continue to omit the marketing footer, leaving the composer unobstructed.

## Navigation

Public and chat navigation share a full-screen native modal dialog below 1280px. A React portal prevents parent spacing utilities from offsetting the overlay. The dialog has an internally scrolling surface, safe-area padding, grouped controls, 48px menu targets, and transform/opacity transitions lasting 300ms. It stays modal during slide-out; reduced motion closes immediately.

Native modal behavior prevents interaction with the underlying page. Explicit Tab/Shift+Tab wrapping keeps keyboard focus inside; Escape and the close button dismiss it. Page scroll position and prior body styles are restored, and focus returns to the opener without scrolling. Opening a room-creation or expiry dialog releases the navigation modal immediately so it cannot hide the next dialog. Incoming voice calls also retain their existing menu-dismissal behavior. Desktop resizing dismisses mobile navigation.

All room action callbacks and creator permission conditions are preserved. Non-creators do not see an empty danger section. Backend APIs, authentication, Socket.IO handlers, WebRTC signaling, cleanup logic, and database migrations were not changed.

## Files

| File | Purpose |
| --- | --- |
| `client/index.html` | Safe areas and browser keyboard resizing. |
| `client/src/pages/ChatPage.tsx` | Viewport shell, compact header/composer, desktop controls in context rail. |
| `client/src/pages/LandingPage.tsx` | Shared full-screen public navigation through tablet widths. |
| `client/src/components/common/Footer.tsx` | Redesigned semantic public footer. |
| `client/src/components/common/NavigationOverlay.tsx` | Shared accessible animated full-screen modal navigation. |
| `client/src/components/chat/CommandCenter.tsx` | Chat wrapper around shared navigation. |
| `client/src/hooks/useVisibleViewport.ts` | Visual viewport sizing and listener/frame cleanup. |
| `client/src/styles/globals.css` | Scoped chat, overlay, and footer styles using existing tokens. |
| `client/src/tests/footer.test.tsx` | Semantic footer and required text/year regression coverage. |
| `client/src/tests/navigation-overlay.test.tsx` | Scroll lock, delayed close, Escape, reduced motion, restoration and unmount cleanup. |
| `client/src/tests/visible-viewport.test.tsx` | Keyboard-sized viewport updates, zoom behavior and cleanup. |
| `server/src/tests/call.integration.test.ts` | Actual React UI, responsive navigation/layout and WebRTC browser regressions. Only tests changed on the server. |
| `docs/RESPONSIVE_UI_REDESIGN.md` | This verification record. |

## Executed verification

- `npm run build`: server TypeScript and client TypeScript/Vite production builds passed.
- `npm run typecheck`: server, client and manual harness checks passed.
- `npm run lint`: server and client ESLint passed.
- `git diff --check`: passed.
- Full `npm test` with `RUN_WEBRTC_BROWSER=1` and separate disposable local PostgreSQL database URLs: **122 backend + 61 frontend tests passed; 0 failed; 0 skipped**.

The final database run used loopback PostgreSQL at port 55439, database `nullchannel_test_ui_20261009_1130` for general integration and a separate empty `nullchannel_test_ui_migration_final_20261009_1137` for migration verification. No Supabase or ImageKit credentials were required. The migration tests refuse non-loopback databases or names outside the `nullchannel_test` prefix; the migration audit also requires an empty database.

The browser suite verified Chromium at **320, 375, 390, 430, 768, 1024, 1280 and 1440px**, in light and dark themes:

- No horizontal document overflow; one visible connection indicator.
- Transcript exceeds 600px at a 900px viewport with idle calling UI; composer remains within the viewport and below the transcript.
- Full-screen chat navigation below 1280px; forward/backward focus wrapping, 44px-or-larger menu/voice targets, Escape/close dismissal and restored focus.
- Reserved typing geometry and unchanged scroll position while reading older messages; unread counts and explicit jump-to-newest remain functional.
- A simulated 390x430 visible viewport keeps the composer reachable and leaves a usable transcript; local typing does not change transcript geometry.
- Reduced-motion navigation; public mobile/tablet menu geometry, page scroll restoration and private-room creation dialog handoff.
- Footer responsiveness and no footer inside chat.
- Authenticated two-party WebRTC negotiation, bidirectional RTP audio with synthetic Chromium media, mute/unmute, hangup, track stopping and peer closure; group-room calling stays unavailable.

Screenshots of mobile/tablet navigation, mobile/desktop calls and both footer themes were inspected locally. Test screenshots are ignored artifacts, not committed assets.

## Limits

Responsive tests use desktop Chromium viewport emulation. Physical iOS/Android keyboards, mobile browser chrome, Firefox and WebKit were not verified. The VisualViewport hook has focused unit coverage but needs device smoke testing before release. WebRTC testing used real browser peer connections with synthetic microphone input and disabled external STUN; this does not verify physical microphones, speakers or cross-network connectivity. No live Supabase/ImageKit provider tests or production load tests were run.

This UI patch requires no new packages, runtime environment variables, backend changes or migrations. The feature branch already contains earlier backend/migration work; follow its existing deployment prerequisites when separately approved. Do not deploy the whole branch under the assumption that every prior change is UI-only.
