/* global window, RTCPeerConnection */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import { createManualDatabase } from '../../manual/database.js';
const launcher = fileURLToPath(new URL('../../manual/run.mjs',import.meta.url));
const origin = 'http://127.0.0.1:5179';
let users: [Awaited<ReturnType<typeof session>>,Awaited<ReturnType<typeof session>>];
let child: ChildProcess; let output = ''; const sockets: Socket[] = [];
const event = (socket: Socket,name: string) => new Promise<Record<string,unknown>>((resolve,reject) => {
  const timer = setTimeout(() => { socket.off(name,handler); reject(new Error(`No ${name}`)); },5000);
  const handler = (value: Record<string,unknown>) => { clearTimeout(timer); resolve(value); }; socket.once(name,handler);
});
const ack = (socket: Socket,name: string,payload: object) => new Promise<{ ok: boolean; callId?: string }>((resolve,reject) => socket.timeout(5000).emit(name,payload,(error: Error,result: { ok: boolean }) => error ? reject(error) : resolve(result)));
const session = async () => {
  const response = await fetch(`${origin}/api/session`,{ method: 'POST',headers: { Origin: origin,'Content-Type': 'application/json' },body: '{}' });
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { identityId: string } };
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return { identity: body.data.identityId,cookie };
};
const joined = async (user: Awaited<ReturnType<typeof session>>,name: string) => {
  const socket = connect(origin,{ autoConnect: false,reconnection: false,transports: ['websocket'],extraHeaders: { Origin: origin,Cookie: user.cookie } });
  sockets.push(socket); const ready = event(socket,'connect'); socket.connect(); await ready;
  const room = event(socket,'room-joined'); socket.emit('join-room',{ roomCode: 'TEST1234',senderId: user.identity,senderName: name }); await room; return socket;
};
describe('isolated manual harness',() => {
  beforeAll(async () => {
    child = spawn(process.execPath,[launcher],{ env: { ...process.env,NULLCHANNEL_MANUAL_PORT: '5179',NODE_ENV: 'test',VITE_API_URL: 'https://production.invalid',SUPABASE_URL: 'https://production.invalid',IMAGEKIT_URL_ENDPOINT: 'https://production.invalid' },stdio: ['ignore','pipe','pipe'] });
    await new Promise<void>((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error(`Harness did not start: ${output.slice(-1500)}`)),20000);
      const read = (chunk: Buffer) => { output += chunk.toString(); if (output.includes('LOCAL VOICE TEST READY')) { clearTimeout(timer); resolve(); } };
      child.stdout!.on('data',read); child.stderr!.on('data',read);
      child.once('exit',code => { clearTimeout(timer); reject(new Error(`Harness exited ${code}: ${output.slice(-1500)}`)); }); child.once('error',reject);
    });
  },25000);
  afterAll(async () => {
    sockets.forEach(socket => socket.disconnect());
    if (child && child.exitCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit',() => resolve())); child.kill('SIGINT');
      await Promise.race([exited,new Promise<void>(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); },8000); timer.unref(); exited.then(() => clearTimeout(timer)); })]);
      expect(child.exitCode).toBe(0);
    }
  },10000);
  it('serves the actual app and refuses CSRF session creation',async () => {
    expect((await fetch(`${origin}/chat/TEST1234`)).status).toBe(200);
    expect((await fetch(`${origin}/api/session`,{ method: 'POST',headers: { Origin: 'https://evil.invalid' } })).status).toBe(403);
    expect((await fetch(`${origin}/__manual/stop`,{ method: 'POST',headers: { Origin: origin,'X-Manual-Shutdown': 'wrong-token' } })).status).toBe(403);
    expect((await fetch(`${origin}/__manual/health`)).status).toBe(200);
  });
  it('issues distinct HttpOnly sessions, preserves refresh identity and authorizes real signaling',async () => {
    const a = await session(); const b = await session(); users = [a,b]; expect(a.identity).not.toBe(b.identity);
    const renewed = await fetch(`${origin}/api/session`,{ method: 'POST',headers: { Origin: origin,Cookie: a.cookie } });
    expect((await renewed.json() as { data: { identityId: string } }).data.identityId).toBe(a.identity);
    expect(renewed.headers.getSetCookie().every(cookie => cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict'))).toBe(true);
    const first = await joined(a,'Alice'); const second = await joined(b,'Bob');
    const incoming = event(second,'call:incoming'); const invitation = await ack(first,'call:invite',{ roomCode: 'TEST1234' });
    expect(invitation.ok).toBe(true); await incoming; expect((await ack(second,'call:reject',{ callId: invitation.callId })).ok).toBe(true);
    expect((await fetch(`${origin}/api/media/upload`,{ method: 'POST',headers: { Origin: origin,Cookie: a.cookie } })).status).toBe(503);
    first.disconnect(); second.disconnect();
  });
  it.skipIf(process.env.RUN_WEBRTC_BROWSER !== '1')('ordinary browser entry flow negotiates real synthetic audio without API interception',async () => {
    await verifyBrowsers(users);
  },45000);
  it('revokes an actual memory-backed session',async () => {
    const [a] = users;
    const revoke = await fetch(`${origin}/api/session`,{ method: 'DELETE',headers: { Origin: origin,Cookie: a.cookie } }); expect(revoke.status).toBe(200);
    expect((await fetch(`${origin}/api/rooms/TEST1234/messages`,{ headers: { Cookie: a.cookie } })).status).toBe(401);
  });
});
it('refuses production mode before opening servers',() => {
  const result = spawnSync(process.execPath,[launcher],{ env: { ...process.env,NODE_ENV: 'production' },encoding: 'utf8' });
  expect(result.status).toBe(1); expect(result.stderr).toContain('refuses NODE_ENV=production'); expect(result.stdout).not.toContain('READY');
});
it('keeps fixture storage local, bounded and capacity checks atomic',async () => {
  const db = createManualDatabase();
  await db.from('anonymous_sessions').insert({ identity_id: 'owner' });
  const results = await Promise.all(['guest','third'].map(identity => db.rpc('join_room',{ p_room: db.room.id,p_sender: identity,p_name: 'Member' })));
  expect(results.filter(result => !result.error)).toHaveLength(1);
  expect(() => db.from('media_uploads')).toThrow('Unsupported local fixture table');
  for (let i=0;i<31;i++) await db.from('anonymous_sessions').insert({ identity_id: `identity-${i}` });
  expect((await db.from('anonymous_sessions').insert({ identity_id: 'overflow' })).error).not.toBeNull();
});

async function verifyBrowsers(users: [Awaited<ReturnType<typeof session>>,Awaited<ReturnType<typeof session>>]) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true,args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
  try {
    const pages = [];
    for (const [index,user] of users.entries()) {
      const context = await browser.newContext({ permissions: ['microphone'] });
      await context.addCookies(user.cookie.split('; ').map(pair => ({ name: pair.split('=')[0],value: pair.split('=')[1],url: origin,httpOnly: true,sameSite: 'Strict' as const })));
      await context.addInitScript(() => {
        const fixture = window as unknown as { __manualPeers: RTCPeerConnection[] }; fixture.__manualPeers = [];
        window.RTCPeerConnection = new Proxy(window.RTCPeerConnection,{ construct(target,args) { const peer = Reflect.construct(target,args) as RTCPeerConnection; fixture.__manualPeers.push(peer); return peer; } });
      });
      const page = await context.newPage(); pages.push(page);
      await page.goto(`${origin}/chat/TEST1234`); await page.getByPlaceholder('Your name').fill(index ? 'Bob' : 'Alice'); await page.getByRole('button',{ name: 'Continue',exact: true }).click();
    }
    const [a,b] = pages;
    await a.getByRole('button',{ name: 'Start voice call',exact: true }).click();
    await b.getByRole('dialog').waitFor(); await b.getByRole('button',{ name: 'Accept',exact: true }).click();
    for (const page of pages) {
      await page.getByText('Voice Call Connected',{ exact: true }).waitFor({ timeout: 20000 });
      await page.waitForFunction(async () => {
        const peer = (window as unknown as { __manualPeers: RTCPeerConnection[] }).__manualPeers[0]; if (!peer) return false;
        const stats = await peer.getStats(); let audio = false;
        stats.forEach(row => { if (row.type === 'inbound-rtp' && row.kind === 'audio' && row.bytesReceived > 0) audio = true; }); return audio;
      });
    }
    await a.getByRole('button',{ name: 'Mute microphone',exact: true }).click(); await a.getByRole('button',{ name: 'Unmute microphone',exact: true }).click();
    await b.getByRole('button',{ name: 'End voice call',exact: true }).click();
    for (const page of pages) { await page.getByText('Call ended',{ exact: true }).waitFor(); expect(await page.evaluate(() => (window as unknown as { __manualPeers: RTCPeerConnection[] }).__manualPeers.every(peer => peer.connectionState === 'closed'))).toBe(true); }
  } finally { await browser.close(); }
}
