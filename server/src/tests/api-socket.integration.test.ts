import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
const { state, from, rpc } = vi.hoisted(() => {
  Object.assign(process.env, { NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173', SUPABASE_URL: 'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only', IMAGEKIT_PUBLIC_KEY: 'test-public', IMAGEKIT_PRIVATE_KEY: 'test-private', IMAGEKIT_URL_ENDPOINT: 'https://test.invalid', SOCKET_JOIN_LIMIT: '2', SOCKET_MESSAGE_LIMIT: '2' });
  const identity = '11111111-1111-4111-8111-111111111111';
  const owner = '22222222-2222-4222-8222-222222222222';
  const state = { valid: true, member: true, dbFailure: false, identity, room: { id: '33333333-3333-4333-8333-333333333333', code: 'TEST1234', creator_id: owner, room_type: 'group', room_name: 'Test room', expires_at: new Date(Date.now()+3600000).toISOString() }, message: { id: '44444444-4444-4444-8444-444444444444', room_id: '33333333-3333-4333-8333-333333333333', sender_id: owner, sender_name: 'Owner', type: 'text', created_at: new Date().toISOString(), deleted: false, burn_after_read: false } };
  const from = vi.fn((table: string) => {
    const result = (single: boolean) => {
      if (state.dbFailure) return { data: null, error: new Error('private database details'), count: null };
      let data: unknown;
      if (table === 'anonymous_sessions') data = state.valid ? { id: 'session', identity_id: state.identity, revoked_at: null, expires_at: new Date(Date.now()+3600000).toISOString(), access_expires_at: new Date(Date.now()+600000).toISOString() } : null;
      else if (table === 'rooms') data = single ? state.room : [state.room];
      else if (table === 'room_members') data = single ? (state.member ? { id: 'member' } : null) : [];
      else if (table === 'messages') data = single ? state.message : [];
      else data = single ? null : [];
      if (table === 'anonymous_sessions' && !single) data = data ? [data] : [];
      return { data, error: null, count: 0 };
    };
    const chain: Record<string, unknown> = {};
    for (const key of ['select','eq','in','gt','lte','is','not','order','limit','insert','update','delete','upsert']) chain[key] = () => chain;
    chain.maybeSingle = () => Promise.resolve(result(true)); chain.single = () => Promise.resolve(result(true));
    chain.then = (resolve: (value: unknown) => void) => Promise.resolve(result(false)).then(resolve);
    return chain;
  });
  return { state, from, rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (['wipe_room','extend_room'].includes(name) && args.p_sender !== state.room.creator_id) return { data: null, error: { message: 'FORBIDDEN' } };
    return { data: [] as unknown[], error: null };
  }) };
});
vi.mock('../config/supabase.js', () => ({ supabase: { from, rpc } }));
vi.mock('../config/imagekit.js', () => ({ imagekit: { upload: vi.fn(async (options: { folder: string; fileName: string }) => ({ fileId: 'actual-provider-id', filePath: `${options.folder}/${options.fileName}`, url: 'https://media.test/file' })), deleteFile: vi.fn() } }));
import { app } from '../app.js';
import { onlineIdentities } from '../sockets/emitter.js';
import { createSocketServer } from '../sockets/index.js';
const cookie = `nc_access=${'a'.repeat(64)}`;
const origin = 'http://localhost:5173';
beforeEach(() => { state.identity = randomUUID(); state.valid = true; state.member = true; state.dbFailure = false; state.message.burn_after_read = false; state.message.sender_id = state.room.creator_id; vi.clearAllMocks(); });
describe('real Express routes with isolated database boundary', () => {
  it('issues HttpOnly cookies without adopting a legacy UUID and supports revocation', async () => {
    const response = await request(app).post('/api/session').set('Origin',origin).send({ senderId: state.room.creator_id });
    expect(response.status).toBe(200); expect(response.body.data.identityId).not.toBe(state.room.creator_id);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(2); for (const value of cookies) { expect(value).toContain('HttpOnly'); expect(value).toContain('SameSite=Strict'); }
    expect(cookies[0]).toContain('Max-Age=900');
    expect((await request(app).delete('/api/session').set('Origin',origin).set('Cookie',`nc_refresh=${'b'.repeat(64)}`)).status).toBe(200);
  });
  it('rejects missing and expired credentials', async () => {
    expect((await request(app).get('/api/rooms/TEST1234/messages')).status).toBe(401);
    state.valid = false;
    expect((await request(app).get('/api/rooms/TEST1234/messages').set('Cookie',cookie)).status).toBe(401);
  });
  it('denies history and participant details to nonmembers', async () => {
    state.member = false;
    for (const path of ['messages','participants']) expect((await request(app).get(`/api/rooms/TEST1234/${path}`).set('Cookie',cookie)).status).toBe(403);
    const preview = await request(app).get('/api/rooms/TEST1234').set('Cookie',cookie);
    expect(preview.status).toBe(200); expect(preview.body.data.id).toBeUndefined(); expect(preview.body.data.creator_id).toBeNull();
  });
  it('prevents identity spoofing to delete or edit someone else’s message', async () => {
    const path = `/api/rooms/TEST1234/messages/${state.message.id}`;
    const deletion = await request(app).delete(path).set('Cookie',cookie).set('Origin',origin).send({ senderId: state.message.sender_id });
    const edit = await request(app).patch(path).set('Cookie',cookie).set('Origin',origin).send({ senderId: state.message.sender_id, content: 'overwrite' });
    expect(deletion.status).toBe(403); expect(edit.status).toBe(403);
  });
  it.each(['terminate','wipe'])('prevents forged creator-only %s', async action => {
    const response = await request(app).post(`/api/rooms/TEST1234/${action}`).set('Cookie',cookie).set('Origin',origin).send({ senderId: state.room.creator_id });
    expect(response.status).toBe(403);
  });
  it('binds room creation to the authenticated identity', async () => {
    rpc.mockResolvedValueOnce({ data: [state.room] as never[], error: null });
    const response = await request(app).post('/api/rooms').set('Cookie',cookie).set('Origin',origin).send({ senderId: state.room.creator_id, senderName: 'Guest', roomName: 'Room', roomType: 'private', expiresInMinutes: 15 });
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('create_room', expect.objectContaining({ p_sender: state.identity }));
  });
  it('rejects legacy delivery receipts without starting a burn deadline',async () => {
    state.message.burn_after_read = true;
    const response = await request(app).post(`/api/rooms/TEST1234/messages/${state.message.id}/burn-read`).set('Cookie',cookie).set('Origin',origin).send({ senderId: state.room.creator_id });
    expect(response.status).toBe(409); expect(response.body.error.code).toBe('CLIENT_UPGRADE_REQUIRED'); expect(rpc).not.toHaveBeenCalled();
  });
  it('binds viewport receipts to authenticated identity and rejects client timestamps',async () => {
    state.message.burn_after_read = true;
    const deadline = { first_seen_at: new Date().toISOString(),burn_expires_at: new Date(Date.now()+60000).toISOString() };
    rpc.mockResolvedValueOnce({ data: [deadline] as never[],error: null });
    const path = `/api/rooms/TEST1234/messages/${state.message.id}/burn-read`;
    const response = await request(app).post(path).set('Cookie',cookie).set('Origin',origin).send({ senderId: state.room.creator_id,viewProtocol: 'focused-viewport-v1' });
    expect(response.status).toBe(200); expect(response.body.data).toEqual(deadline);
    expect(rpc).toHaveBeenCalledWith('mark_message_seen',{ p_room: state.room.id,p_message: state.message.id,p_sender: state.identity });
    const malformed = await request(app).post(path).set('Cookie',cookie).set('Origin',origin).send({ viewProtocol: 'focused-viewport-v1',first_seen_at: '2100-01-01' });
    expect(malformed.status).toBe(400);
  });
  it('rejects burn receipts from nonmembers, senders, expired credentials and wrong origins',async () => {
    state.message.burn_after_read = true; const path = `/api/rooms/TEST1234/messages/${state.message.id}/burn-read`;
    const receipt = () => request(app).post(path).set('Cookie',cookie).set('Origin',origin).send({ viewProtocol: 'focused-viewport-v1' });
    state.member = false; expect((await receipt()).status).toBe(403); state.member = true;
    state.message.sender_id = state.identity; expect((await receipt()).status).toBe(403);
    state.valid = false; expect((await receipt()).status).toBe(401);
    expect((await request(app).post(path).set('Cookie',cookie).set('Origin','https://untrusted.invalid').send({ viewProtocol: 'focused-viewport-v1' })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('denies CSRF writes and hides database error details', async () => {
    expect((await request(app).post('/api/rooms').set('Cookie',cookie).send({})).status).toBe(403);
    state.dbFailure = true;
    const response = await request(app).get('/api/rooms/TEST1234/messages').set('Cookie',cookie);
    expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain('private database');
  });
  it('accepts a valid bounded upload with forged identity overwritten', async () => {
    const response = await request(app).post('/api/media/upload').set('Cookie',cookie).set('Origin',origin).field('roomCode','TEST1234').field('senderId',state.room.creator_id).field('type','file').attach('file',Buffer.from('hello'),{ filename: 'hello.txt', contentType: 'text/plain' });
    expect(response.status).toBe(200); expect(response.body.data.fileId).toBe('actual-provider-id');
    expect(response.body.data.filePath).not.toBe(response.body.data.fileId);
  });
  it('rejects too many multipart fields and oversized files at middleware', async () => {
    const fields = await request(app).post('/api/media/upload').set('Cookie',cookie).set('Origin',origin).field('roomCode','TEST1234').field('senderId',state.identity).field('type','file').field('unexpected','extra').attach('file',Buffer.from('hello'),'file.txt');
    expect(fields.status).toBe(400);
    const oversized = await request(app).post('/api/media/upload').set('Cookie',cookie).set('Origin',origin).field('roomCode','TEST1234').field('senderId',state.identity).field('type','file').attach('file',Buffer.alloc(15*1024*1024+1),'big.txt');
    expect(oversized.status).toBe(413);
  });
});
const waitFor = (socket: ClientSocket, event: string) => new Promise<unknown>((resolve,reject) => {
  const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timed out: ${event}`)); },3000);
  const handler = (payload: unknown) => { clearTimeout(timer); resolve(payload); };
  socket.once(event,handler);
});
describe('real Socket.IO transport with isolated database boundary', () => {
  const http = createServer(app); const io = createSocketServer(http); const clients: ClientSocket[] = [];
  let url = '';
  beforeAll(async () => { await new Promise<void>(resolve => http.listen(0,'127.0.0.1',resolve)); const address = http.address(); if (!address || typeof address === 'string') throw new Error('No test listener'); url = `http://127.0.0.1:${address.port}`; });
  afterAll(async () => { clients.forEach(s => s.disconnect()); await new Promise<void>(resolve => io.close(() => resolve())); });
  const client = (credentials = true) => { const s = connect(url,{ autoConnect: false, reconnection: false, transports: ['websocket'], extraHeaders: { Origin: origin, ...(credentials ? { Cookie: cookie } : {}) } }); clients.push(s); return s; };
  it('rejects an unauthenticated handshake', async () => {
    const s = client(false); const error = waitFor(s,'connect_error'); s.connect(); expect((await error as Error).message).toBe('SESSION_EXPIRED');
  });
  it('counts multiple tabs once and preserves authorization after a network disconnect', async () => {
    const first = client(); const second = client();
    const connectedA = waitFor(first,'connect'); first.connect(); await connectedA;
    const connectedB = waitFor(second,'connect'); second.connect(); await connectedB;
    const joinedA = waitFor(first,'room-joined'); first.emit('join-room',{ roomCode: 'TEST1234', senderId: state.identity, senderName: 'Guest' }); await joinedA;
    const joinedB = waitFor(second,'room-joined'); second.emit('join-room',{ roomCode: 'TEST1234', senderId: state.identity, senderName: 'Guest' }); await joinedB;
    expect(await onlineIdentities(state.room.id)).toEqual([state.identity]);
    first.disconnect(); await new Promise(resolve => setTimeout(resolve,10));
    expect(await onlineIdentities(state.room.id)).toEqual([state.identity]);
    expect(from.mock.calls.filter(call => call[0] === 'room_members').length).toBeGreaterThan(0);
    second.disconnect();
  });
  it('rejects invented Socket.IO burn receipts instead of bypassing the REST authorization path',async () => {
    const s=client(); const connected=waitFor(s,'connect'); s.connect(); await connected;
    const rejected=waitFor(s,'socket-error'); s.emit('burn-read',{ roomCode: 'TEST1234',messageId: state.message.id,senderId: state.room.creator_id });
    expect(await rejected).toMatchObject({ code: 'RATE_LIMITED' }); expect(rpc).not.toHaveBeenCalled(); s.disconnect();
  });
  it('authenticates identity, atomically authorizes joining, validates and rate-limits events', async () => {
    const s = client(); const connected = waitFor(s,'connect'); s.connect(); await connected;
    const joined = waitFor(s,'room-joined'); s.emit('join-room',{ roomCode: 'TEST1234', senderId: state.room.creator_id, senderName: 'Guest' }); await joined;
    expect(rpc).toHaveBeenCalledWith('join_room', expect.objectContaining({ p_sender: state.identity }));
    const invalid = waitFor(s,'socket-error'); s.emit('send-message',{ roomCode: 'bad', senderId: state.identity }); expect(await invalid).toMatchObject({ code: 'VALIDATION_ERROR' });
    const joinedAgain = waitFor(s,'room-joined'); s.emit('join-room',{ roomCode: 'TEST1234', senderId: state.identity, senderName: 'Guest' }); await joinedAgain;
    const limited = waitFor(s,'socket-error'); s.emit('join-room',{ roomCode: 'TEST1234', senderId: state.identity, senderName: 'Guest' }); expect(await limited).toMatchObject({ code: 'RATE_LIMITED' });
  });
});
