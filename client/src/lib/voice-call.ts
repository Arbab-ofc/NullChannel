import type { Socket } from 'socket.io-client';
import { AudioPeer, microphoneError, NETWORK_FAILURE } from './webrtc';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';
export type CallView = { phase: CallPhase; callId: string | null; peerName: string; roomName: string; muted: boolean; playbackBlocked: boolean; connectedAt: number | null; message: string; accepting: boolean };
export const callTransitions: Record<CallPhase, readonly CallPhase[]> = {
  idle: ['outgoing','incoming'], outgoing: ['connecting','ended','failed'], incoming: ['connecting','ended','failed'],
  connecting: ['connected','ended','failed'], connected: ['reconnecting','ended','failed'],
  reconnecting: ['connected','ended','failed'], ended: ['idle'], failed: ['idle']
};
const empty = (): CallView => ({ phase: 'idle',callId: null,peerName: '',roomName: '',muted: false,playbackBlocked: false,connectedAt: null,message: '',accepting: false });
export const callIsActive = (phase: CallPhase) => !['idle','ended','failed'].includes(phase);
type Invitation = { callId: string; roomCode: string; peerName: string; roomName: string };
type Ack = { ok: boolean; code?: string; message?: string; callId?: string };
export class VoiceCall {
  private view = empty();
  private listeners = new Set<() => void>();
  private engine: AudioPeer | null = null;
  private caller = false;
  private disposed = false;
  private handlers = new Map<string, (...args: unknown[]) => void>();
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  constructor(private socket: Socket, readonly roomCode: string,
    private peerFactory: (caller: boolean, callbacks: ConstructorParameters<typeof AudioPeer>[1]) => AudioPeer = (caller,callbacks) => new AudioPeer(caller,callbacks)) {}
  snapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<CallView>) { if (this.disposed) return; this.view = { ...this.view,...patch }; for (const listener of this.listeners) listener(); }
  private transition(phase: CallPhase, patch: Partial<CallView> = {}) {
    if (phase === this.view.phase) { this.update(patch); return; }
    if (!callTransitions[this.view.phase].includes(phase)) return;
    this.update({ ...patch,phase });
  }
  private reset() { if (['ended','failed'].includes(this.view.phase)) { this.transition('idle'); this.update(empty()); } }
  private request(event: string, data: object) {
    return new Promise<Ack>((resolve,reject) => {
      if (!this.socket.connected) return reject(new Error('Voice signaling disconnected. Please reconnect and call again.'));
      this.socket.timeout(8000).emit(event,data,(error: Error | null, result: Ack) => {
        if (error || !result) reject(new Error('Voice signaling timed out. Please call again.'));
        else if (!result.ok) reject(new Error(result.message ?? 'Calling is unavailable.'));
        else resolve(result);
      });
    });
  }
  attach() {
    this.disposed = false;
    const on = <T,>(event: string,handler: (payload: T) => void) => {
      const typed = (...args: unknown[]) => handler(args[0] as T); this.handlers.set(event,typed); this.socket.on(event,typed);
    };
    on<Invitation>('call:outgoing',payload => {
      if (payload.roomCode === this.roomCode && this.view.phase === 'outgoing' && !this.view.callId) this.update({ callId: payload.callId,peerName: payload.peerName,roomName: payload.roomName });
    });
    on<Invitation>('call:incoming',payload => {
      if (payload.roomCode !== this.roomCode) return;
      if (this.view.phase === 'outgoing' && !this.view.callId) { this.transition('ended'); this.reset(); }
      this.reset();
      if (this.view.phase === 'idle') { this.caller = false; this.transition('incoming',{ callId: payload.callId,peerName: payload.peerName,roomName: payload.roomName }); }
    });
    on<{ callId: string }>('call:accepted',payload => {
      if (payload.callId !== this.view.callId || !['incoming','outgoing'].includes(this.view.phase)) return;
      this.transition('connecting',{ accepting: false });
      if (this.caller) { this.engine = this.createPeer(); const engine = this.engine; void engine.offer().catch(error => this.fail(microphoneError(error))); }
    });
    on<{ callId: string; revision: number; sdp: string }>('call:offer',payload => this.description('offer',payload));
    on<{ callId: string; revision: number; sdp: string }>('call:answer',payload => this.description('answer',payload));
    on<{ callId: string; revision: number; candidate: RTCIceCandidateInit }>('call:ice-candidate',payload => {
      if (payload.callId === this.view.callId && this.engine) void this.engine.candidate(payload.revision,payload.candidate).catch(() => this.fail('Invalid voice connection data.'));
    });
    on<{ callId: string }>('call:reconnecting',payload => { if (payload.callId === this.view.callId) this.transition('reconnecting'); });
    for (const event of ['call:ended','call:rejected','call:timeout']) on<{ callId: string; reason: string }>(event,payload => {
      if (payload.callId !== this.view.callId) return;
      const messages: Record<string,string> = { 'no-answer': this.caller ? 'No Answer' : 'Missed Call', declined: 'Call declined', 'connection-timeout': NETWORK_FAILURE, 'network-failed': NETWORK_FAILURE, 'peer-disconnected': 'The other participant disconnected.', 'answered-elsewhere': 'Call answered in another tab.', 'room-expired': 'The room expired.', 'membership-lost': 'Room membership ended.' };
      this.finish(payload.reason.includes('timeout') || payload.reason === 'network-failed' ? 'failed' : 'ended',messages[payload.reason] ?? 'Call ended.');
    });
    on('disconnect',() => this.finish('ended','Connection lost. Reconnect and start a new call.'));
    on('room-expired',() => this.finish('ended','The room closed.'));
    on<{ code: string }>('membership-revoked',payload => { if (payload.code === this.roomCode) this.finish('ended','Room membership ended.'); });
  }
  setRoom(eligible: boolean, expiresAt?: string) {
    if (this.expiry) clearTimeout(this.expiry); this.expiry = null;
    if (!eligible) { this.end(); return; }
    if (expiresAt) this.expiry = setTimeout(() => this.end(), Math.max(0,Date.parse(expiresAt)-Date.now()));
  }
  async invite() {
    this.reset(); if (this.view.phase !== 'idle' || this.disposed) return;
    this.caller = true; this.transition('outgoing');
    try { const result = await this.request('call:invite',{ roomCode: this.roomCode }); if (this.disposed && result.callId) void this.request('call:end',{ callId: result.callId }).catch(() => undefined); }
    catch (error) { if (this.snapshot().phase === 'outgoing') this.fail(microphoneError(error)); }
  }
  async accept() {
    if (this.view.phase !== 'incoming' || this.view.accepting) return;
    const id = this.view.callId; const generation = this.generation;
    this.update({ accepting: true }); this.engine = this.createPeer(); const peer = this.engine;
    try {
      await peer.start();
      if (this.disposed || this.generation !== generation || this.view.callId !== id) { peer.close(); return; }
      await this.request('call:accept',{ callId: id });
    } catch (error) { if (this.generation === generation) this.fail(microphoneError(error)); }
  }
  async reject() {
    if (this.view.phase !== 'incoming' || this.view.accepting) return;
    const id = this.view.callId;
    this.finish('ended','Call declined.');
    try { await this.request('call:reject',{ callId: id }); } catch { /* The server also expires the invitation. */ }
  }
  private createPeer() {
    const id = this.view.callId; const generation = this.generation;
    const current = () => !this.disposed && this.view.callId === id && this.generation === generation;
    return this.peerFactory(this.caller,{
      description: async (kind,revision,sdp) => { if (current()) await this.request(`call:${kind}`,{ callId: id,revision,sdp }); },
      candidate: async (revision,candidate) => { if (current()) await this.request('call:ice-candidate',{ callId: id,revision,candidate }); },
      state: phase => {
        if (!current()) return;
        this.transition(phase,{ connectedAt: phase === 'connected' ? this.view.connectedAt ?? Date.now() : this.view.connectedAt });
        void this.request(`call:${phase}`,{ callId: id }).catch(() => { if (current()) this.fail('Voice signaling was interrupted. Please call again.'); });
      }, error: message => { if (current()) this.fail(message); }, playback: blocked => { if (current()) this.update({ playbackBlocked: blocked }); }
    });
  }
  private description(kind: 'offer' | 'answer',payload: { callId: string; revision: number; sdp: string }) {
    if (payload.callId !== this.view.callId || !this.engine) return;
    const generation = this.generation;
    void this.engine.description(kind,payload.revision,payload.sdp).catch(() => { if (this.generation === generation) this.fail('Voice negotiation failed. Please call again.'); });
  }
  mute() { if (!['connected','reconnecting','connecting'].includes(this.view.phase)) return; const muted = !this.view.muted; this.engine?.mute(muted); this.update({ muted }); }
  play() { void this.engine?.play(); }
  private finish(phase: 'ended' | 'failed',message: string) {
    this.generation += 1; this.engine?.close(); this.engine = null;
    if (callIsActive(this.view.phase)) this.transition(phase,{ message,accepting: false,muted: false,playbackBlocked: false });
  }
  private fail(message: string) { const id = this.view.callId; this.finish('failed',message); if (id && this.socket.connected) void this.request('call:end',{ callId: id }).catch(() => undefined); }
  end() { const id = this.view.callId; this.finish('ended','Call ended.'); if (id && this.socket.connected) void this.request('call:end',{ callId: id }).catch(() => undefined); }
  dismiss() { this.reset(); }
  dispose() {
    this.end(); this.disposed = true;
    for (const [event,handler] of this.handlers) this.socket.off(event,handler); this.handlers.clear();
    if (this.expiry) clearTimeout(this.expiry); this.expiry = null;
  }
}
