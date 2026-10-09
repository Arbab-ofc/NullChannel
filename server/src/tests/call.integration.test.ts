/* global window, document, location, getComputedStyle, RTCPeerConnection, MediaStream */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket as Client } from 'socket.io-client';
const { state, from, roomLookup } = vi.hoisted(() => {
  Object.assign(process.env,{ NODE_ENV: 'test',CLIENT_URL: 'http://127.0.0.1:5178',SUPABASE_URL: 'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY: 'test-only',IMAGEKIT_PUBLIC_KEY: 'test',IMAGEKIT_PRIVATE_KEY: 'test',IMAGEKIT_URL_ENDPOINT: 'https://test.invalid',SOCKET_CONNECTION_LIMIT: '1000',CALL_RING_TIMEOUT_MS: '1000',CALL_CONNECT_TIMEOUT_MS: '1000',CALL_DISCONNECT_GRACE_MS: '1000',CALL_MAX_CANDIDATES: '16',CALL_INVITE_LIMIT: '3',CALL_SIGNAL_LIMIT: '20' });
  const state = { valid: true, revokedTokens: [] as string[], identities: ['','',''], room: { id: '33333333-3333-4333-8333-333333333333', code: 'TEST1234', room_type: 'private',room_name: 'Voice test',creator_id: '',expires_at: '' },members: [] as { sender_id: string; sender_name: string; joined_at: string }[] };
  const from = vi.fn((_table: string) => { const chain: Record<string,unknown> = {}; for (const key of ['select','eq','is','gt']) chain[key] = () => chain; chain.maybeSingle = async () => ({ data: state.valid ? { id: 'session' } : null,error: null }); return chain; });
  const roomLookup = vi.fn(async () => Date.parse(state.room.expires_at) > Date.now() ? state.room : null);
  return { state,from,roomLookup };
});
vi.mock('../config/supabase.js',() => ({ supabase: { from } }));
vi.mock('../services/session.service.js',() => ({ readCookie: (header: string | undefined) => header?.split('nc_access=')[1]?.split(';')[0], verifySession: async (token: string) => {
  const index = ['a','b','c'].indexOf(token?.[0]); return state.valid && index >= 0 && !state.revokedTokens.includes(token?.[0]) ? { id: `session-${index}`, identity_id: state.identities[index] } : null;
} }));
vi.mock('../services/room.service.js',() => ({ getRoomByCode: roomLookup }));
vi.mock('../services/membership.service.js',() => ({ getParticipantsForRoom: async () => state.members, isActiveMember: async (_room: string, identity: string) => state.members.some(m => m.sender_id === identity),joinMembership: vi.fn(), leaveMembership: vi.fn() }));
import { createSocketServer } from '../sockets/index.js';
import { getCallRegistry } from '../sockets/call.socket.js';
import { emitRoomExpired, emitRoomExtended, revokeRoomSockets } from '../sockets/emitter.js';
import { audioSdp, callIceSchema } from '../schemas/call.schema.js';
const http = createServer(); const io = createSocketServer(http); const registry = getCallRegistry(io);
let url = ''; const clients: Client[] = [];
const origin = 'http://127.0.0.1:5178';
const wait = (socket: Client,event: string) => new Promise<Record<string,unknown>>((resolve,reject) => {
  const timer = setTimeout(() => { socket.off(event,handler); reject(new Error(`Missing ${event}`)); },3000);
  const handler = (payload: Record<string,unknown>) => { clearTimeout(timer); resolve(payload); }; socket.once(event,handler);
});
const ack = (socket: Client,event: string,payload: object) => new Promise<{ ok: boolean; code?: string; callId?: string }>((resolve,reject) => socket.timeout(3000).emit(event,payload,(error: Error,reply: { ok: boolean }) => error ? reject(error) : resolve(reply)));
const client = async (index: number) => {
  const socket = connect(url,{ autoConnect: false,reconnection: false,transports: ['websocket'],extraHeaders: { Origin: origin,Cookie: `nc_access=${['a','b','c'][index].repeat(64)}` } });
  clients.push(socket); const ready = wait(socket,'connect'); socket.connect(); await ready; await io.sockets.sockets.get(socket.id!)!.join(state.room.id); return socket;
};
const pair = async () => [await client(0),await client(1)] as const;
const invite = async (a: Client,b: Client) => { const incoming = wait(b,'call:incoming'); const result = await ack(a,'call:invite',{ roomCode: state.room.code }); expect(result.ok).toBe(true); await incoming; return result.callId!; };
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 AA:BB\r\na=ice-ufrag:test\r\n';
beforeAll(async () => { await new Promise<void>(resolve => http.listen(0,'127.0.0.1',resolve)); const address = http.address(); if (!address || typeof address === 'string') throw new Error('No port'); url = `http://127.0.0.1:${address.port}`; });
afterAll(async () => { registry.dispose(); clients.forEach(s => s.disconnect()); await new Promise<void>(resolve => io.close(() => resolve())); });
beforeEach(async () => {
  registry.dispose(); clients.splice(0).forEach(s => s.disconnect()); await new Promise(resolve => setTimeout(resolve,10));
  state.valid = true; state.revokedTokens = []; state.identities = [randomUUID(),randomUUID(),randomUUID()];
  state.room.room_type = 'private'; state.room.creator_id = state.identities[0]; state.room.expires_at = new Date(Date.now()+3600000).toISOString();
  state.members = state.identities.slice(0,2).map((identity,index) => ({ sender_id: identity,sender_name: ['Alice','Bob'][index],joined_at: new Date().toISOString() })); roomLookup.mockClear();
});
describe('authenticated real Socket.IO call signaling',() => {
  it('invites, accepts and relays audio-only offer, answer and candidates to the bound peer only',async () => {
    const [a,b] = await pair(); const outsider = await client(2); const leaked = vi.fn(); outsider.on('call:offer',leaked);
    const id = await invite(a,b); expect((await ack(b,'call:accept',{ callId: id })).ok).toBe(true);
    const offered = wait(b,'call:offer'); expect((await ack(a,'call:offer',{ callId: id,revision: 1,sdp })).ok).toBe(true); await offered;
    const answered = wait(a,'call:answer'); expect((await ack(b,'call:answer',{ callId: id,revision: 1,sdp })).ok).toBe(true); await answered;
    const ice = wait(b,'call:ice-candidate'); expect((await ack(a,'call:ice-candidate',{ callId: id,revision: 1,candidate: { candidate: 'candidate:1 1 UDP 123 127.0.0.1 12345 typ host',sdpMid: '0',sdpMLineIndex: 0 } })).ok).toBe(true); await ice;
    await ack(a,'call:connected',{ callId: id }); await ack(b,'call:connected',{ callId: id });
    expect(registry.calls.get(id)?.status).toBe('connected'); expect(leaked).not.toHaveBeenCalled();
    await ack(b,'call:end',{ callId: id }); expect(registry.calls.size).toBe(0);
    expect(from.mock.calls.every(args => args[0] === 'anonymous_sessions')).toBe(true);
  });
  it('rejects group rooms',async () => { const [a] = await pair(); state.room.room_type = 'group'; expect(await ack(a,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ ok: false,code: 'PRIVATE_ONLY' }); });
  it('rejects nonmembers, single-member rooms and offline peers',async () => {
    const a = await client(0); expect(await ack(a,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ code: 'PEER_OFFLINE' });
    const c = await client(2); expect(await ack(c,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ code: 'JOIN_REQUIRED' });
    state.members.pop(); expect(await ack(a,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ code: 'PEER_UNAVAILABLE' });
  });
  it('disconnects expired/revoked sessions before dispatching signaling',async () => {
    const [a] = await pair(); state.valid = false; const disconnected = wait(a,'disconnect'); a.emit('call:invite',{ roomCode: 'TEST1234' }); await disconnected; expect(registry.calls.size).toBe(0);
  });
  it.each(['call:accept','call:reject','call:offer','call:answer','call:ice-candidate','call:end'])('rejects third-party %s',async event => {
    const [a,b] = await pair(); const c = await client(2); const id = await invite(a,b);
    const payload = event === 'call:offer' || event === 'call:answer' ? { callId: id,revision: 1,sdp } : event === 'call:ice-candidate' ? { callId: id,revision: 1,candidate: { candidate: 'candidate:test',sdpMid: '0',sdpMLineIndex: 0 } } : { callId: id };
    expect(await ack(c,event,payload)).toMatchObject({ ok: false,code: 'INVALID_CALL' }); expect(registry.calls.size).toBe(1);
  });
  it('rejects expired peer sessions before ringing and terminates a bound revoked peer',async () => {
    const [a,b] = await pair(); state.revokedTokens = ['b']; expect(await ack(a,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ code: 'PEER_OFFLINE' });
    state.revokedTokens = []; const id = await invite(a,b); await ack(b,'call:accept',{ callId: id }); state.revokedTokens = ['b'];
    expect(await ack(a,'call:offer',{ callId: id,revision: 1,sdp })).toMatchObject({ code: 'SESSION_EXPIRED' }); expect(registry.calls.size).toBe(0);
  });
  it('rejects expired rooms, a third active member and unknown call UUIDs',async () => {
    const [a] = await pair(); state.room.expires_at = new Date(Date.now()-1).toISOString(); expect(await ack(a,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ code: 'ROOM_EXPIRED' });
    state.room.expires_at = new Date(Date.now()+60000).toISOString(); state.members.push({ sender_id: state.identities[2],sender_name: 'Third',joined_at: new Date().toISOString() });
    expect(await ack(a,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ code: 'PEER_UNAVAILABLE' });
    expect(await ack(a,'call:offer',{ callId: randomUUID(),revision: 1,sdp })).toMatchObject({ code: 'INVALID_CALL' });
  });
  it('bounds outstanding authorization work and releases all pending slots',async () => {
    const releases: Array<(value: { ok: true }) => void> = [];
    const work = Array.from({ length: 64 },() => registry.dispatch(() => new Promise(resolve => releases.push(resolve))));
    await expect(registry.dispatch(async () => ({ ok: true }))).rejects.toThrow('busy');
    releases.forEach(release => release({ ok: true })); await Promise.all(work); expect(await registry.dispatch(async () => ({ ok: true }))).toEqual({ ok: true });
  });
  it('rejects invalid IDs, spoofed fields, video SDP and malformed candidates',async () => {
    const [a,b] = await pair(); const id = await invite(a,b);
    expect(await ack(a,'call:end',{ callId: 'bad' })).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await ack(b,'call:accept',{ callId: id,senderId: state.identities[0] })).toMatchObject({ code: 'VALIDATION_ERROR' });
    await ack(b,'call:accept',{ callId: id });
    expect(await ack(a,'call:offer',{ callId: id,revision: 1,sdp: sdp+'m=video 9 UDP/TLS/RTP/SAVPF 96\r\n' })).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await ack(a,'call:ice-candidate',{ callId: id,revision: 1,candidate: { candidate: 'invalid',sdpMid: '0',sdpMLineIndex: 0 } })).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('resolves simultaneous invitations atomically and marks identities busy',async () => {
    const [a,b] = await pair(); const results = await Promise.all([ack(a,'call:invite',{ roomCode: 'TEST1234' }),ack(b,'call:invite',{ roomCode: 'TEST1234' })]);
    expect(results.filter(r => r.ok)).toHaveLength(1); expect(results.find(r => !r.ok)?.code).toBe('BUSY'); expect(registry.calls.size).toBe(1);
  });
  it('rejects another tab signaling and lets only the first accepting callee tab own the call',async () => {
    const [a,b] = await pair(); const tab = await client(1); const callerTab = await client(0); const id = await invite(a,b);
    const results = await Promise.all([ack(b,'call:accept',{ callId: id }),ack(tab,'call:accept',{ callId: id })]); expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(await ack(callerTab,'call:end',{ callId: id })).toMatchObject({ code: 'OTHER_TAB' });
  });
  it('rejects duplicate acceptance, late rejection, early answers and replayed offers',async () => {
    const [a,b] = await pair(); const id = await invite(a,b); await ack(b,'call:accept',{ callId: id });
    for (const event of ['call:accept','call:reject']) expect(await ack(b,event,{ callId: id })).toMatchObject({ code: 'INVALID_STATE' });
    expect(await ack(b,'call:answer',{ callId: id,revision: 1,sdp })).toMatchObject({ code: 'INVALID_STATE' });
    await ack(a,'call:offer',{ callId: id,revision: 1,sdp }); expect(await ack(a,'call:offer',{ callId: id,revision: 1,sdp })).toMatchObject({ code: 'INVALID_STATE' });
  });
  it('releases both identities on rejection and permits a fresh invitation',async () => { const [a,b] = await pair(); const id = await invite(a,b); await ack(b,'call:reject',{ callId: id }); expect(registry.calls.size).toBe(0); await invite(a,b); });
  it('expires ringing invitations and releases the registry',async () => { const [a,b] = await pair(); const timeout = wait(a,'call:timeout'); await invite(a,b); expect(await timeout).toMatchObject({ reason: 'no-answer' }); expect(registry.calls.size).toBe(0); });
  it('times out accepted calls that never connect',async () => { const [a,b] = await pair(); const id = await invite(a,b); const ended = wait(a,'call:ended'); await ack(b,'call:accept',{ callId: id }); expect(await ended).toMatchObject({ reason: 'connection-timeout' }); expect(registry.calls.size).toBe(0); });
  it.each([0,1])('cleans up when participant %s disconnects',async index => { const [a,b] = await pair(); await invite(a,b); const ended = wait(index ? a : b,'call:ended'); [a,b][index].disconnect(); await ended; expect(registry.calls.size).toBe(0); });
  it('expires active calls at room expiry without waiting for the room cleanup worker',async () => { const [a,b] = await pair(); state.room.expires_at = new Date(Date.now()+150).toISOString(); const ended = wait(a,'call:ended'); await invite(a,b); expect(await ended).toMatchObject({ reason: 'room-expired' }); });
  it('ends calls on room termination or membership revocation',async () => {
    const [a,b] = await pair(); await invite(a,b); emitRoomExpired(state.room.id,{ reason: 'terminated-by-creator' }); expect(registry.calls.size).toBe(0);
    await io.sockets.sockets.get(a.id!)!.join(state.room.id); await io.sockets.sockets.get(b.id!)!.join(state.room.id); await invite(a,b);
    await revokeRoomSockets(state.room.id,'TEST1234',state.identities[1]); expect(registry.calls.size).toBe(0);
  });
  it('reschedules room expiration on extension',async () => {
    const [a,b] = await pair(); state.room.expires_at = new Date(Date.now()+150).toISOString(); const id = await invite(a,b);
    state.room.expires_at = new Date(Date.now()+3000).toISOString(); emitRoomExtended(state.room.id,{ code: 'TEST1234',expiresAt: state.room.expires_at,extendByMinutes: 1 });
    await new Promise(resolve => setTimeout(resolve,200)); expect(registry.calls.has(id)).toBe(true);
  });
  it('rate-limits invitations and safely handles repeated ends',async () => {
    const [a,b] = await pair(); for (let i=0;i<3;i++) { const id = await invite(a,b); await ack(a,'call:end',{ callId: id }); expect((await ack(a,'call:end',{ callId: id })).ok).toBe(true); }
    expect(await ack(a,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ code: 'RATE_LIMITED' }); expect(registry.calls.size).toBe(0);
  });
  it('limits candidates per call and rate-limits signaling packets',async () => {
    const [a,b] = await pair(); const id = await invite(a,b); await ack(b,'call:accept',{ callId: id }); await ack(a,'call:offer',{ callId: id,revision: 1,sdp });
    const payload = { callId: id,revision: 1,candidate: { candidate: 'candidate:1 1 UDP 123 127.0.0.1 12345 typ host',sdpMid: '0',sdpMLineIndex: 0 } };
    for (let i=0;i<16;i++) expect((await ack(a,'call:ice-candidate',payload)).ok).toBe(true);
    expect(await ack(a,'call:ice-candidate',payload)).toMatchObject({ code: 'CANDIDATE_LIMIT' });
    for (let i=0;i<3;i++) await ack(a,'call:ice-candidate',payload);
    expect(await ack(a,'call:ice-candidate',payload)).toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('handles simultaneous recovery reports and releases disconnected calls after grace',async () => {
    const [a,b] = await pair(); const id = await invite(a,b); await ack(b,'call:accept',{ callId: id });
    await ack(a,'call:offer',{ callId: id,revision: 1,sdp }); await ack(b,'call:answer',{ callId: id,revision: 1,sdp });
    await ack(a,'call:connected',{ callId: id }); await ack(b,'call:connected',{ callId: id });
    const ended = wait(a,'call:ended'); const recovery = await Promise.all([ack(a,'call:reconnecting',{ callId: id }),ack(b,'call:reconnecting',{ callId: id })]);
    expect(recovery.every(result => result.ok)).toBe(true); expect(await ended).toMatchObject({ reason: 'network-failed' }); expect(registry.calls.size).toBe(0);
  });
  it('fails closed on room lookup errors and releases an existing call without leaking database details',async () => {
    const [a,b] = await pair(); roomLookup.mockRejectedValueOnce(new Error('private database password'));
    expect(await ack(a,'call:invite',{ roomCode: 'TEST1234' })).toMatchObject({ ok: false,code: 'CALL_UNAVAILABLE' });
    expect(registry.calls.size).toBe(0);
    const id = await invite(a,b); roomLookup.mockRejectedValueOnce(new Error('private database password'));
    expect(await ack(b,'call:accept',{ callId: id })).toEqual({ ok: false,code: 'CALL_UNAVAILABLE',message: 'Calling is temporarily unavailable.' });
    expect(registry.calls.size).toBe(0);
  });
  it('bounds SDP and ICE payloads without retaining raw audio',() => {
    expect(audioSdp.safeParse('x'.repeat(50000)).success).toBe(false);
    expect(callIceSchema.safeParse({ callId: randomUUID(),revision: 1,candidate: { candidate: 'candidate:'+ 'x'.repeat(2048),sdpMid: '0',sdpMLineIndex: 0 } }).success).toBe(false);
    expect([...registry.calls.values()]).toEqual([]);
  });
});

it.skipIf(process.env.RUN_WEBRTC_BROWSER !== '1')('two real Chromium contexts negotiate audio, exchange media, mute and release resources',async () => {
  const { chromium } = await import('playwright');
  const { createServer: createViteServer } = await import('vite');
  const { env } = await import('../config/env.js');
  const tailwind = (await import('tailwindcss/loadConfig.js')).default(new URL('../../../client/tailwind.config.ts',import.meta.url).pathname);
  const original = [env.CALL_RING_TIMEOUT_MS,env.CALL_CONNECT_TIMEOUT_MS,env.CALL_SIGNAL_LIMIT];
  env.CALL_RING_TIMEOUT_MS = 30000; env.CALL_CONNECT_TIMEOUT_MS = 20000; env.CALL_SIGNAL_LIMIT = 300;
  const vite = await createViteServer({ define: { 'import.meta.env.VITE_WEBRTC_STUN_URLS': '""' },root: new URL('../../../client',import.meta.url).pathname,configFile: false,
    plugins: [(await import('@vitejs/plugin-react')).default()],css: { postcss: { plugins: [(await import('tailwindcss')).default({ ...tailwind, content: [new URL('../../../client',import.meta.url).pathname+'/src/**/*.{ts,tsx}',new URL('../../../client/index.html',import.meta.url).pathname] }), (await import('autoprefixer')).default()] } },server: { host: '127.0.0.1',port: 5178,strictPort: true,proxy: { '/socket.io': { target: url,ws: true } } } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    await vite.listen(); browser = await chromium.launch({ headless: true,args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
    const pages = [];
    for (const index of [0,1]) {
      const context = await browser.newContext({ permissions: ['microphone'],viewport: { width: index ? 390 : 1280,height: index ? 844 : 900 } });
      await context.addCookies([{ name: 'nc_access',value: ['a','b'][index].repeat(64),url: origin,httpOnly: true,sameSite: 'Strict' }]);
      await context.addInitScript(() => {
        const rtc = window as unknown as { __callPeers: RTCPeerConnection[]; __callStreams: MediaStream[] };
        rtc.__callPeers = []; rtc.__callStreams = [];
        const OriginalPeer = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(OriginalPeer,{ construct(target,args) { const peer = Reflect.construct(target,args) as RTCPeerConnection; rtc.__callPeers.push(peer); return peer; } });
        const originalMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => { const stream = await originalMedia(constraints); rtc.__callStreams.push(stream); return stream; };
        sessionStorage.setItem('nullchannel_name_TEST1234',location.hash === '#callee' ? 'Bob' : 'Alice');
      });
      const page = await context.newPage(); pages.push(page);
      await page.route('**/api/**',async route => {
        const path = new URL(route.request().url()).pathname;
        let data: unknown = [];
        if (path === '/api/session') data = { identityId: state.identities[index] };
        else if (path === '/api/rooms/TEST1234') data = state.room;
        else if (path.endsWith('/participants')) data = state.members.map(member => ({ ...member,online: true }));
        else if (path.startsWith('/api/users/')) data = [state.room];
        await route.fulfill({ status: 200,contentType: 'application/json',body: JSON.stringify({ success: true,data }) });
      });
      await page.goto(`${origin}/chat/TEST1234${index ? '#callee' : ''}`);
    }
    const [a,b] = pages;
    await vi.waitFor(() => expect([...io.sockets.sockets.values()].filter(socket => socket.rooms.has(state.room.id))).toHaveLength(2),{ timeout: 10000 });
    await a.getByRole('button',{ name: 'Start voice call',exact: true }).waitFor();
    // Exercise the actual transcript hook with real socket delivery before calling.
    const baseMessages = Array.from({ length: 50 },(_,index) => ({ id: randomUUID(),room_id: state.room.id,sender_id: state.identities[0],sender_name: 'Alice',type: 'text',content: `History ${index} `+'long message '.repeat(20),created_at: new Date(Date.now()+index).toISOString() }));
    for (const message of baseMessages) io.to(state.room.id).emit('receive-message',message);
    await b.getByText('History 49',{ exact: false }).waitFor();
    const transcript = b.getByRole('region',{ name: 'Messages' });
    await transcript.evaluate(element => { element.scrollTop = 150; element.dispatchEvent(new Event('scroll')); });
    const before = await transcript.evaluate(element => element.scrollTop);
    const headerBefore = await b.locator('.chat-header').boundingBox();
    const viewportBefore = await transcript.boundingBox();
    for (let index=0; index<3; index++) io.to(state.room.id).emit('receive-message',{ id: randomUUID(),room_id: state.room.id,sender_id: state.identities[0],sender_name: 'Alice',type: 'text',content: `Incoming ${index}`,created_at: new Date().toISOString() });
    await b.getByRole('button',{ name: 'Scroll to 3 new messages' }).waitFor();
    expect(await transcript.evaluate(element => element.scrollTop)).toBe(before);
    for (let index=0; index<12; index++) io.to(state.room.id).emit('user-typing',{ roomCode: state.room.code,senderId: state.identities[0],senderName: 'Alice' });
    await b.getByText('Alice is typing',{ exact: true }).waitFor();
    expect(await transcript.boundingBox()).toEqual(viewportBefore); expect(await b.locator('.chat-header').boundingBox()).toEqual(headerBefore);
    expect(await transcript.evaluate(element => element.scrollTop)).toBe(before);
    await b.getByRole('button',{ name: 'Scroll to 3 new messages' }).click();
    expect(await transcript.evaluate(element => element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(2);
    expect(await b.locator('.new-message-indicator').isDisabled()).toBe(true);
    // Check both themes and all requested widths, including the 1280px breakpoint.
    for (const theme of ['dark','light']) {
      await b.evaluate(theme => document.documentElement.classList.toggle('light',theme === 'light'),theme);
      for (const width of [320,375,390,430,768,1024,1280,1440]) {
        await b.setViewportSize({ width,height: 900 });
        await b.evaluate(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
        expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await b.locator('.connection-status:visible').count()).toBe(1);
        expect(await b.locator('.chat-expiry').isVisible()).toBe(true);
        const transcriptBounds = await transcript.boundingBox();
        const composerBounds = await b.locator('.chat-composer').boundingBox();
        expect(transcriptBounds!.height,JSON.stringify({ width,header: await b.locator('.chat-header').boundingBox(),composer: composerBounds,shell: await b.locator('.chat-shell').boundingBox(),children: await b.locator('.chat-workspace').evaluate(element => Array.from(element.children).map(child => ({ tag: child.tagName,cls: child.className,height: child.getBoundingClientRect().height }))) })).toBeGreaterThan(600);
        expect(composerBounds!.y+composerBounds!.height).toBeLessThanOrEqual(900);
        expect(transcriptBounds!.y+transcriptBounds!.height).toBeLessThan(composerBounds!.y);
        const phone = await b.getByRole('button',{ name: 'Start voice call',exact: true }).boundingBox();
        expect(phone!.width).toBeGreaterThanOrEqual(44); expect(phone!.height).toBeGreaterThanOrEqual(44);
        if (width < 1280) {
          await b.getByRole('button',{ name: 'Toggle chat menu' }).click(); await b.getByRole('dialog',{ name: 'SESSION CONTROLS' }).waitFor();
          const overlay = await b.getByRole('dialog',{ name: 'SESSION CONTROLS' }).boundingBox();
          expect(overlay).toEqual({ x: 0,y: 0,width,height: 900 });
          const dialog = b.getByRole('dialog',{ name: 'SESSION CONTROLS' });
          const buttons = dialog.getByRole('button');
          await buttons.last().focus(); await b.keyboard.press('Tab');
          expect(await buttons.first().evaluate(element => element === document.activeElement)).toBe(true);
          await b.keyboard.press('Shift+Tab');
          expect(await buttons.last().evaluate(element => element === document.activeElement)).toBe(true);
          for (const button of await buttons.all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          expect(await dialog.getByRole('button',{ name: 'Panic Wipe' }).count()).toBe(0);
          expect(await dialog.getByRole('button',{ name: 'Copy Channel ID' }).count()).toBe(1);
          if (theme === 'dark' && [375,768].includes(width)) { await b.waitForTimeout(320); await b.screenshot({ path: `../output/playwright/navigation-${width}.png` }); }
          if (width === 320) await b.getByRole('button',{ name: 'Close session controls' }).click(); else await b.keyboard.press('Escape'); await b.waitForTimeout(320);
          expect(await b.getByRole('button',{ name: 'Toggle chat menu' }).evaluate(element => element === document.activeElement)).toBe(true);
        }
      }
    }
    // Simulate a smaller visible viewport without claiming physical mobile keyboard testing.
    await b.setViewportSize({ width: 390,height: 430 });
    await b.evaluate(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
    expect((await b.locator('.chat-composer').boundingBox())!.y+(await b.locator('.chat-composer').boundingBox())!.height).toBeLessThanOrEqual(430);
    expect((await transcript.boundingBox())!.height).toBeGreaterThan(100);
    await b.locator('textarea').fill('A stable local typing test');
    const typedBounds = await transcript.boundingBox(); await b.locator('textarea').fill(''); expect(await transcript.boundingBox()).toEqual(typedBounds);
    await b.setViewportSize({ width: 390,height: 844 });
    await b.emulateMedia({ reducedMotion: 'reduce' });
    await b.getByRole('button',{ name: 'Toggle chat menu' }).click();
    await b.getByRole('dialog',{ name: 'SESSION CONTROLS' }).waitFor();
    expect(await b.locator('.navigation-overlay__surface').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(.001);
    await b.keyboard.press('Escape'); await b.getByRole('dialog',{ name: 'SESSION CONTROLS' }).waitFor({ state: 'hidden' });
    await b.emulateMedia({ reducedMotion: 'no-preference' });
    await a.getByRole('button',{ name: 'Start voice call',exact: true }).click();
    await b.getByRole('dialog').waitFor();
    for (const width of [320,375,390,430,768,1024,1440]) {
      await b.setViewportSize({ width,height: 900 });
        await b.evaluate(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await b.getByRole('dialog',{ name: 'Incoming Voice Call' }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const label of ['Accept','Decline']) {
        const bounds = await b.getByRole('button',{ name: label,exact: true }).boundingBox();
        expect(bounds).not.toBeNull(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
      }
    }
    await b.setViewportSize({ width: 390,height: 844 });
    await b.screenshot({ path: '../output/playwright/voice-incoming-mobile.png' });
    expect(await b.getByRole('dialog',{ name: 'Incoming Voice Call' }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await b.keyboard.press('Tab');
    expect(await b.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true);
    expect(await b.evaluate(() => (window as unknown as { __callStreams: MediaStream[] }).__callStreams.length)).toBe(0);
    await b.getByRole('button',{ name: 'Accept',exact: true }).click();
    for (const page of pages) {
      await page.getByText('Voice Call Connected',{ exact: true }).waitFor({ timeout: 20000 });
      await page.waitForFunction(async () => {
        const peers = (window as unknown as { __callPeers: RTCPeerConnection[] }).__callPeers;
        if (!peers[0] || peers[0].connectionState !== 'connected') return false;
        const stats = await peers[0].getStats(); let received = false; let encrypted = false;
        stats.forEach(report => { if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.bytesReceived > 0) received = true; if (report.type === 'transport' && report.dtlsState === 'connected') encrypted = true; }); return received && encrypted;
      },undefined,{ timeout: 20000 });
    }
    await a.getByRole('button',{ name: 'Mute microphone',exact: true }).click();
    expect(await a.evaluate(() => (window as unknown as { __callStreams: MediaStream[] }).__callStreams[0].getAudioTracks()[0].enabled)).toBe(false);
    await a.getByRole('button',{ name: 'Unmute microphone',exact: true }).click();
    expect(await a.evaluate(() => (window as unknown as { __callStreams: MediaStream[] }).__callStreams[0].getAudioTracks()[0].enabled)).toBe(true);
    for (const width of [320,375,390,430,768,1024,1440]) {
      await b.setViewportSize({ width,height: 900 });
        await b.evaluate(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const label of ['Mute microphone','End voice call']) {
        const bounds = await b.getByRole('button',{ name: label,exact: true }).boundingBox();
        expect(bounds).not.toBeNull(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
      }
      await b.getByRole('button',{ name: 'End voice call',exact: true }).focus();
      expect(await b.getByRole('button',{ name: 'End voice call',exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    }
    await b.setViewportSize({ width: 390,height: 844 });
    await a.screenshot({ path: '../output/playwright/voice-desktop.png' }); await b.screenshot({ path: '../output/playwright/voice-mobile.png' });
    expect(await b.locator('main').evaluate(element => getComputedStyle(element).display)).toBe('grid');
    const overflow = await b.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); expect(overflow).toBe(false);
    await b.getByRole('button',{ name: 'End voice call',exact: true }).click();
    for (const page of pages) {
      await page.getByText('Call ended',{ exact: true }).waitFor();
      expect(await page.evaluate(() => {
        const rtc = window as unknown as { __callStreams: MediaStream[]; __callPeers: RTCPeerConnection[] };
        return rtc.__callStreams.every(stream => stream.getVideoTracks().length === 0 && stream.getTracks().every(track => track.readyState === 'ended')) && rtc.__callPeers.every(peer => peer.connectionState === 'closed');
      })).toBe(true);
    }
    expect(registry.calls.size).toBe(0);
    state.room.room_type = 'group'; await a.reload();
    await a.getByText('CHANNEL ID: TEST1234',{ exact: true }).waitFor();
    expect(await a.getByRole('button',{ name: 'Start voice call',exact: true }).count()).toBe(0);
    expect(await a.locator('.site-footer').count()).toBe(0);
    for (const socket of io.sockets.sockets.values()) if (socket.data.identity === state.identities[0]) socket.disconnect(true);
    await a.locator('.connection-status').filter({ hasText: 'Disconnected' }).waitFor();
    await b.goto(origin+'/');
    await b.getByText('Designed & developed by',{ exact: false }).waitFor();
    for (const theme of ['dark','light']) {
      await b.evaluate(theme => document.documentElement.classList.toggle('light',theme === 'light'),theme);
      for (const width of [320,375,390,430,768,1024,1280,1440]) {
        await b.setViewportSize({ width,height: 900 });
        await b.evaluate(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
        expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await b.locator('.site-footer').count()).toBe(1);
      }
    }
    await b.locator('.site-footer').screenshot({ path: '../output/playwright/footer-light.png' });
    await b.evaluate(() => document.documentElement.classList.remove('light'));
    await b.setViewportSize({ width: 375,height: 844 });
    await b.locator('.site-footer').screenshot({ path: '../output/playwright/footer-dark-mobile.png' });
    for (const width of [375,768,1024]) {
      await b.setViewportSize({ width,height: 900 });
      await b.evaluate(() => window.scrollTo(0,120));
      const scroll = await b.evaluate(() => window.scrollY);
      // Avoid Playwright's automatic pre-click scrolling of the offscreen header.
      await b.getByRole('button',{ name: 'Toggle menu' }).evaluate(element => { element.focus({ preventScroll: true }); element.click(); });
      const menu = b.getByRole('dialog',{ name: 'Navigation',exact: true }); await menu.waitFor();
      await b.evaluate(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
      expect(await menu.boundingBox()).toEqual({ x: 0,y: 0,width,height: 900 });
      await b.getByRole('button',{ name: 'Close navigation' }).click(); await menu.waitFor({ state: 'hidden' });
      expect(await b.evaluate(() => window.scrollY)).toBe(scroll);
      expect(await b.getByRole('button',{ name: 'Toggle menu' }).evaluate(element => element === document.activeElement)).toBe(true);
    }
    await b.getByRole('button',{ name: 'Toggle menu' }).click();
    await b.getByRole('dialog',{ name: 'Navigation',exact: true }).getByRole('button',{ name: 'Create Private' }).click();
    await b.getByRole('dialog',{ name: 'Navigation',exact: true }).waitFor({ state: 'hidden' });
    expect(await b.getByText('CREATE PRIVATE ROOM',{ exact: true }).isVisible()).toBe(true);
  } finally {
    await browser?.close(); await vite.close(); [env.CALL_RING_TIMEOUT_MS,env.CALL_CONNECT_TIMEOUT_MS,env.CALL_SIGNAL_LIMIT] = original;
  }
},90000);
