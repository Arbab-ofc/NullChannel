import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { readCookie, verifySession } from '../services/session.service.js';
import { accessCookie } from '../middlewares/auth.middleware.js';
import { env } from '../config/env.js';
import { getRoomByCode } from '../services/room.service.js';
import { getParticipantsForRoom } from '../services/membership.service.js';
import { callRefSchema, callInviteSchema, callDescriptionSchema, callIceSchema, type CallAck } from '../schemas/call.schema.js';
import { allowEvent } from './rateLimit.js';
import type { z } from 'zod';

type Participant = { identity: string; socketId: string; name: string };
export type CallSession = {
  callId: string; roomId: string; roomCode: string; roomName: string;
  caller: Participant; callee: Participant; status: 'ringing' | 'connecting' | 'connected';
  createdAt: number; acceptedAt?: number; recovering: boolean; revision: number; answered: boolean;
  candidates: Map<string, number>; connected: Set<string>; timer: ReturnType<typeof setTimeout>;
  expiryTimer: ReturnType<typeof setTimeout>;
};
class CallFailure extends Error { constructor(public code: string, message: string) { super(message); } }
export class CallRegistry {
  readonly calls = new Map<string, CallSession>();
  private readonly busy = new Map<string, string>();
  private pending = 0;
  constructor(private io: Server) {}
  async dispatch(work: () => Promise<CallAck>) {
    if (this.pending >= 64) throw new CallFailure('BUSY','Calling is temporarily busy.');
    this.pending += 1;
    try { return await work(); } finally { this.pending -= 1; }
  }
  private emit(call: CallSession, event: string, extra: object = {}) {
    const payload = { callId: call.callId, roomCode: call.roomCode, ...extra };
    this.io.to(call.caller.socketId).emit(event, payload);
    if (call.callee.socketId) this.io.to(call.callee.socketId).emit(event, payload);
    else for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data.identity === call.callee.identity && socket.rooms.has(call.roomId)) socket.emit(event, payload);
    }
  }
  end(callId: string, reason: string) {
    const call = this.calls.get(callId); if (!call) return;
    clearTimeout(call.timer); clearTimeout(call.expiryTimer);
    this.calls.delete(callId); this.busy.delete(call.caller.identity); this.busy.delete(call.callee.identity);
    call.candidates.clear(); call.connected.clear();
    this.emit(call, reason === 'no-answer' ? 'call:timeout' : reason === 'declined' ? 'call:rejected' : 'call:ended', { reason });
  }
  endRoom(roomId: string, identity?: string) {
    for (const call of this.calls.values()) if (call.roomId === roomId && (!identity || [call.caller.identity,call.callee.identity].includes(identity))) this.end(call.callId, identity ? 'membership-lost' : 'room-closed');
  }
  extend(roomId: string, expiresAt: string) {
    for (const call of this.calls.values()) if (call.roomId === roomId) {
      clearTimeout(call.expiryTimer); call.expiryTimer = this.expiry(call.callId, expiresAt);
    }
  }
  private expiry(id: string, expires: string) {
    const timer = setTimeout(() => this.end(id, 'room-expired'), Math.max(0, Date.parse(expires)-Date.now())); timer.unref(); return timer;
  }
  private timeout(call: CallSession, ms: number, reason: string) {
    clearTimeout(call.timer); call.timer = setTimeout(() => this.end(call.callId,reason), ms); call.timer.unref();
  }
  private async eligible(socket: Socket, code: string) {
    const room = await getRoomByCode(code);
    if (!room || Date.parse(room.expires_at) <= Date.now()) throw new CallFailure('ROOM_EXPIRED','This room is unavailable or expired.');
    if (room.room_type !== 'private') throw new CallFailure('PRIVATE_ONLY','Voice calls are available only in private rooms.');
    const members = await getParticipantsForRoom(room.id);
    if (!members.some(member => member.sender_id === socket.data.identity) || !socket.rooms.has(room.id)) throw new CallFailure('JOIN_REQUIRED','Join this room before calling.');
    if (members.length !== 2 || new Set(members.map(member => member.sender_id)).size !== 2) throw new CallFailure('PEER_UNAVAILABLE','A call needs two room members.');
    if (!socket.connected) throw new CallFailure('DISCONNECTED','Reconnect before calling.');
    return { room, members };
  }
  async invite(socket: Socket, code: string): Promise<CallAck> {
    const { room, members } = await this.eligible(socket,code);
    const other = members.find(member => member.sender_id !== socket.data.identity)!;
    if (this.busy.has(socket.data.identity) || this.busy.has(other.sender_id)) throw new CallFailure('BUSY','One participant is already in a call.');
    if (this.calls.size >= env.CALL_MAX_ACTIVE) throw new CallFailure('BUSY','Calling is temporarily at capacity.');
    const online = [...this.io.sockets.sockets.values()].filter(peer => peer.data.identity === other.sender_id && peer.rooms.has(room.id) && peer.connected);
    const peers: Socket[] = [];
    for (const peer of online.slice(0,8)) {
      const session = await verifySession(readCookie(peer.request.headers.cookie,accessCookie()));
      if (session && session.identity_id === peer.data.identity && session.id === peer.data.sessionId && peer.connected && peer.rooms.has(room.id)) peers.push(peer);
    }
    // No await between these final checks and acquiring both identity locks.
    if (!socket.connected || !socket.rooms.has(room.id) || Date.parse(room.expires_at) <= Date.now()) throw new CallFailure('ROOM_EXPIRED','The room is no longer available.');
    if (this.busy.has(socket.data.identity) || this.busy.has(other.sender_id)) throw new CallFailure('BUSY','One participant is already in a call.');
    if (this.calls.size >= env.CALL_MAX_ACTIVE) throw new CallFailure('BUSY','Calling is temporarily at capacity.');
    if (!peers.length) throw new CallFailure('PEER_OFFLINE','The other participant is not connected.');
    const caller = members.find(member => member.sender_id === socket.data.identity)!;
    const id = randomUUID();
    const call: CallSession = { callId: id, roomId: room.id, roomCode: code, roomName: room.room_name,
      caller: { identity: socket.data.identity, socketId: socket.id, name: caller.sender_name },
      callee: { identity: other.sender_id, socketId: '', name: other.sender_name }, status: 'ringing', createdAt: Date.now(),
      revision: 0, recovering: false, answered: false, candidates: new Map(), connected: new Set(),
      timer: setTimeout(() => this.end(id,'no-answer'),env.CALL_RING_TIMEOUT_MS), expiryTimer: this.expiry(id,room.expires_at) };
    call.timer.unref(); this.calls.set(id,call); this.busy.set(call.caller.identity,id); this.busy.set(call.callee.identity,id);
    const timeouts = { ringMs: env.CALL_RING_TIMEOUT_MS,connectMs: env.CALL_CONNECT_TIMEOUT_MS,disconnectMs: env.CALL_DISCONNECT_GRACE_MS };
    socket.emit('call:outgoing',{ timeouts,callId: id, roomCode: code, peerName: call.callee.name, roomName: room.room_name });
    for (const peer of peers) peer.emit('call:incoming',{ timeouts,callId: id, roomCode: code, peerName: call.caller.name, roomName: room.room_name });
    return { ok: true, callId: id };
  }
  async authorize(socket: Socket, callId: string) {
    const call = this.calls.get(callId);
    if (!call || ![call.caller.identity,call.callee.identity].includes(socket.data.identity)) throw new CallFailure('INVALID_CALL','This call is unavailable.');
    const role = call.caller.identity === socket.data.identity ? 'caller' : 'callee';
    if (call[role].socketId && call[role].socketId !== socket.id) throw new CallFailure('OTHER_TAB','This call belongs to another tab.');
    try {
      const { members } = await this.eligible(socket,call.roomCode);
      if (!members.some(m => m.sender_id === call.caller.identity) || !members.some(m => m.sender_id === call.callee.identity)) throw new Error('Membership changed');
    } catch (error) { this.end(callId,'room-unavailable'); throw error; }
    const otherId = role === 'caller' ? call.callee.socketId : call.caller.socketId;
    if (otherId) {
      const other = this.io.sockets.sockets.get(otherId);
      const session = other ? await verifySession(readCookie(other.request.headers.cookie,accessCookie())) : null;
      if (!other || !session || session.identity_id !== other.data.identity || session.id !== other.data.sessionId) { this.end(callId,'session-ended'); throw new CallFailure('SESSION_EXPIRED','The peer session ended.'); }
    }
    if (!this.calls.has(callId)) throw new CallFailure('INVALID_CALL','This call has ended.');
    return { call, role };
  }
  async action(socket: Socket, event: string, data: { callId: string; revision?: number; sdp?: string; candidate?: unknown }): Promise<CallAck> {
    // Repeating termination after cleanup is safe and leaks no call metadata.
    if (event === 'call:end' && !this.calls.has(data.callId)) return { ok: true };
    const { call, role } = await this.authorize(socket,data.callId);
    if (event === 'call:end') { this.end(call.callId,'hangup'); return { ok: true }; }
    if (event === 'call:accept' || event === 'call:reject') {
      if (role !== 'callee' || call.status !== 'ringing') throw new CallFailure('INVALID_STATE','This invitation has already been handled.');
      if (event === 'call:reject') { this.end(call.callId,'declined'); return { ok: true }; }
      call.callee.socketId = socket.id; call.status = 'connecting'; call.acceptedAt = Date.now();
      this.timeout(call,env.CALL_CONNECT_TIMEOUT_MS,'connection-timeout');
      for (const tab of this.io.sockets.sockets.values()) if (tab.data.identity === call.callee.identity && tab.id !== socket.id) tab.emit('call:ended',{ callId: call.callId, roomCode: call.roomCode, reason: 'answered-elsewhere' });
      this.emit(call,'call:accepted'); return { ok: true };
    }
    if (call.status === 'ringing') throw new CallFailure('INVALID_STATE','Accept the call before negotiating.');
    const target = role === 'caller' ? call.callee.socketId : call.caller.socketId;
    if (!this.io.sockets.sockets.get(target)?.connected || !this.io.sockets.sockets.get(target)?.rooms.has(call.roomId)) { this.end(call.callId,'peer-disconnected'); throw new CallFailure('DISCONNECTED','The other participant disconnected.'); }
    if (event === 'call:offer') {
      if (role !== 'caller' || data.revision !== call.revision+1 || (call.revision > 0 && !call.answered)) throw new CallFailure('INVALID_STATE','Offer is out of sequence.');
      call.revision = data.revision; call.answered = false;
    } else if (event === 'call:answer') {
      if (role !== 'callee' || call.revision === 0 || data.revision !== call.revision || call.answered) throw new CallFailure('INVALID_STATE','Answer is out of sequence.');
      call.answered = true;
    } else if (event === 'call:ice-candidate') {
      if (!call.revision || data.revision !== call.revision) throw new CallFailure('INVALID_STATE','ICE candidate is out of sequence.');
      const count = (call.candidates.get(socket.data.identity) ?? 0)+1;
      if (count > env.CALL_MAX_CANDIDATES) throw new CallFailure('CANDIDATE_LIMIT','Too many connection candidates.');
      call.candidates.set(socket.data.identity,count);
    } else if (event === 'call:connected') {
      if (!call.answered) throw new CallFailure('INVALID_STATE','Negotiation is incomplete.');
      call.connected.add(socket.data.identity);
      if (call.connected.size === 2) { call.status = 'connected'; call.recovering = false; clearTimeout(call.timer); this.emit(call,'call:connected'); }
      return { ok: true };
    } else if (event === 'call:reconnecting') {
      if (call.recovering) return { ok: true };
      if (call.status !== 'connected') throw new CallFailure('INVALID_STATE','The call is not connected.');
      call.status = 'connecting'; call.recovering = true; call.connected.clear(); this.timeout(call,env.CALL_DISCONNECT_GRACE_MS,'network-failed');
      this.emit(call,'call:reconnecting'); return { ok: true };
    }
    this.io.to(target).emit(event,data); return { ok: true };
  }
  disconnected(socket: Socket) {
    for (const call of this.calls.values()) {
      if (call.caller.socketId === socket.id || call.callee.socketId === socket.id) this.end(call.callId,'peer-disconnected');
      else if (call.status === 'ringing' && call.callee.identity === socket.data.identity && ![...this.io.sockets.sockets.values()].some(s => s.id !== socket.id && s.data.identity === call.callee.identity && s.rooms.has(call.roomId))) this.end(call.callId,'peer-disconnected');
    }
  }
  dispose() { for (const id of this.calls.keys()) this.end(id,'server-stopped'); }
}
const registries = new WeakMap<Server, CallRegistry>();
export const getCallRegistry = (io: Server) => {
  let registry = registries.get(io); if (!registry) { registry = new CallRegistry(io); registries.set(io,registry); } return registry;
};
export const registerCallSocket = (io: Server, socket: Socket) => {
  const registry = getCallRegistry(io);
  const schemas: Record<string, z.ZodType> = { 'call:invite': callInviteSchema, 'call:accept': callRefSchema, 'call:reject': callRefSchema,
    'call:end': callRefSchema, 'call:offer': callDescriptionSchema, 'call:answer': callDescriptionSchema,
    'call:ice-candidate': callIceSchema, 'call:connected': callRefSchema, 'call:reconnecting': callRefSchema };
  for (const [event,schema] of Object.entries(schemas)) socket.on(event,(payload: unknown, ack?: (result: CallAck) => void) => {
    const respond = (result: CallAck) => { if (typeof ack === 'function') ack(result); if (!result.ok) socket.emit(result.code === 'BUSY' ? 'call:busy' : 'call:error',result); };
    if (!allowEvent(`${socket.data.identity}:call:${event}`,event === 'call:invite' ? env.CALL_INVITE_LIMIT : env.CALL_SIGNAL_LIMIT)) return respond({ ok: false, code: 'RATE_LIMITED', message: 'Too many call events. Please wait.' });
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return respond({ ok: false, code: 'VALIDATION_ERROR', message: 'Invalid calling payload.' });
    void registry.dispatch(async () => {
      if (event === 'call:invite') return registry.invite(socket,(parsed.data as { roomCode: string }).roomCode);
      return registry.action(socket,event,parsed.data as { callId: string });
    }).then(respond).catch(error => respond({ ok: false, code: error instanceof CallFailure ? error.code : 'CALL_UNAVAILABLE', message: error instanceof CallFailure ? error.message : 'Calling is temporarily unavailable.' }));
  });
  socket.on('disconnect',() => registry.disconnected(socket));
};
