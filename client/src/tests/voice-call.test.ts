// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { AudioPeer, iceConfiguration, microphoneError } from '../lib/webrtc';
import { VoiceCall, callTransitions } from '../lib/voice-call';
class Peer {
  static last: Peer;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState = 'new'; iceConnectionState = 'new';
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  addTrack = vi.fn(); addIceCandidate = vi.fn(async () => undefined); close = vi.fn();
  createOffer = vi.fn(async () => ({ type: 'offer',sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:test\r\n' }));
  createAnswer = vi.fn(async () => ({ type: 'answer',sdp: 'answer' }));
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.localDescription = description; });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.remoteDescription = description; });
  constructor() { Peer.last = this; }
}
const track = { kind: 'audio',enabled: true,onended: null as (() => void) | null,stop: vi.fn() };
const stream = { getTracks: () => [track],getAudioTracks: () => [track] };
const media = vi.fn(async () => stream);
const callbacks = () => ({ description: vi.fn(async () => undefined),candidate: vi.fn(async () => undefined),state: vi.fn(),error: vi.fn(),playback: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks(); track.enabled = true; track.onended = null;
  Object.defineProperty(window,'isSecureContext',{ value: true,configurable: true });
  Object.defineProperty(navigator,'mediaDevices',{ value: { getUserMedia: media,addEventListener: vi.fn(),removeEventListener: vi.fn() },configurable: true });
  media.mockResolvedValue(stream);
  vi.stubGlobal('RTCPeerConnection',Peer);
  vi.stubGlobal('RTCSessionDescription',class { constructor(value: object) { Object.assign(this,value); } });
  vi.stubGlobal('RTCIceCandidate',class { constructor(value: object) { Object.assign(this,value); } });
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('browser audio engine',() => {
  it('captures audio only with processing constraints and releases all resources idempotently',async () => {
    const peer = new AudioPeer(true,callbacks()); await peer.start();
    expect(media).toHaveBeenCalledWith({ audio: { echoCancellation: true,noiseSuppression: true,autoGainControl: true },video: false });
    peer.mute(true); expect(track.enabled).toBe(false); peer.mute(false); expect(track.enabled).toBe(true);
    peer.close(); peer.close(); expect(track.stop).toHaveBeenCalledOnce(); expect(Peer.last.close).toHaveBeenCalledOnce(); expect(Peer.last.ontrack).toBeNull();
  });
  it('stops a stream arriving after cancellation or React unmount',async () => {
    let deliver!: (value: typeof stream) => void; media.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    const peer = new AudioPeer(true,callbacks()); const pending = peer.start(); peer.close(); deliver(stream); await pending; expect(track.stop).toHaveBeenCalledOnce();
  });
  it('applies mute selected while microphone acquisition is pending',async () => {
    let deliver!: (value: typeof stream) => void; media.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    const peer = new AudioPeer(true,callbacks()); const pending = peer.start(); peer.mute(true); deliver(stream); await pending;
    expect(track.enabled).toBe(false); peer.close();
  });
  it('buffers remote ICE before remote SDP and drains it after the answer',async () => {
    const peer = new AudioPeer(true,callbacks()); await peer.offer();
    await peer.candidate(1,{ candidate: 'candidate:host',sdpMid: '0',sdpMLineIndex: 0 }); expect(Peer.last.addIceCandidate).not.toHaveBeenCalled();
    await peer.description('answer',1,'answer'); expect(Peer.last.addIceCandidate).toHaveBeenCalledOnce(); peer.close();
  });
  it('buffers callee ICE even while microphone acquisition is pending',async () => {
    const peer = new AudioPeer(false,callbacks()); await peer.candidate(1,{ candidate: 'candidate:host' });
    await peer.description('offer',1,'offer'); expect(Peer.last.addIceCandidate).toHaveBeenCalledOnce(); peer.close();
  });
  it('uses deterministic roles and rejects unrelated revisions',async () => {
    const peer = new AudioPeer(false,callbacks()); await expect(peer.description('answer',1,'sdp')).rejects.toThrow('role');
    await expect(peer.candidate(3,{ candidate: 'candidate:x' })).rejects.toThrow('sequence'); peer.close();
  });
  it('attaches remote audio and surfaces autoplay restrictions with a retry',async () => {
    const cb = callbacks(); const peer = new AudioPeer(true,cb); await peer.start();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('blocked'));
    Peer.last.ontrack!({ track,streams: [stream] } as unknown as RTCTrackEvent);
    await Promise.resolve(); await Promise.resolve(); expect(cb.playback).toHaveBeenCalledWith(true);
    await peer.play(); expect(cb.playback).toHaveBeenLastCalledWith(false); peer.close();
  });
  it('fails connection timeout and stops microphone tracks',async () => {
    vi.useFakeTimers(); const cb = callbacks(); const peer = new AudioPeer(true,cb,{}, { ringMs: 30,connectMs: 20,disconnectMs: 10 });
    await peer.start(); await vi.advanceTimersByTimeAsync(21); expect(cb.error).toHaveBeenCalled(); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('restarts ICE only as caller and terminates after disconnect grace',async () => {
    vi.useFakeTimers(); const cb = callbacks(); const peer = new AudioPeer(true,cb,{}, { ringMs: 30,connectMs: 200,disconnectMs: 10 }); await peer.offer();
    Peer.last.connectionState = 'disconnected'; Peer.last.onconnectionstatechange!(); await Promise.resolve(); await Promise.resolve();
    expect(cb.state).toHaveBeenCalledWith('reconnecting'); await vi.advanceTimersByTimeAsync(11); expect(cb.error).toHaveBeenCalled();
  });
  it.each(['NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError','SecurityError'])('explains microphone %s',name => { const error = new Error('details'); error.name = name; expect(microphoneError(error)).not.toBe('details'); });
  it('accepts public STUN URLs but rejects embedded TURN credentials',() => {
    expect(iceConfiguration('stun:stun.l.google.com:19302').iceServers).toHaveLength(1);
    expect(() => iceConfiguration('turn:user:secret@relay.example')).toThrow(); expect(iceConfiguration('').iceServers).toEqual([]);
  });
});
const signaling = () => {
  const listeners = new Map<string,Set<(payload: unknown) => void>>();
  const send = vi.fn((event: string,_data: object,callback: (error: null,result: object) => void) => callback(null,{ ok: true,callId: event === 'call:invite' ? 'id' : undefined }));
  const socket = { connected: true,on: (event: string,handler: (payload: unknown) => void) => { const set = listeners.get(event) ?? new Set(); set.add(handler); listeners.set(event,set); },off: (event: string,handler: (payload: unknown) => void) => listeners.get(event)?.delete(handler),timeout: () => ({ emit: send }) };
  const emit = (event: string,payload: unknown) => listeners.get(event)?.forEach(fn => fn(payload));
  return { socket: socket as unknown as Socket,listeners,send,emit };
};
describe('frontend call state and signaling lifecycle',() => {
  it('does not acquire a microphone on incoming notification or rejection',async () => {
    const s = signaling(); const call = new VoiceCall(s.socket,'TEST1234'); call.attach(); s.emit('call:incoming',{ callId: 'id',roomCode: 'TEST1234',peerName: 'Alice',roomName: 'Test' });
    expect(call.snapshot().phase).toBe('incoming'); expect(media).not.toHaveBeenCalled(); await call.reject(); expect(call.snapshot().phase).toBe('ended'); expect(media).not.toHaveBeenCalled(); call.dispose();
  });
  it('requests microphone only after acceptance and handles permission denial',async () => {
    const s = signaling(); const call = new VoiceCall(s.socket,'TEST1234'); call.attach(); s.emit('call:incoming',{ callId: 'id',roomCode: 'TEST1234' });
    media.mockRejectedValueOnce(new DOMException('denied','NotAllowedError')); await call.accept(); expect(call.snapshot()).toMatchObject({ phase: 'failed',message: expect.stringContaining('permission denied') }); call.dispose();
  });
  it('prevents duplicate accepts, mutes, ends and removes only its listeners',async () => {
    const s = signaling(); const call = new VoiceCall(s.socket,'TEST1234'); const other = vi.fn(); s.socket.on('room-expired',other); call.attach();
    s.emit('call:incoming',{ callId: 'id',roomCode: 'TEST1234' }); await Promise.all([call.accept(),call.accept()]); expect(media).toHaveBeenCalledOnce();
    s.emit('call:accepted',{ callId: 'id' }); expect(call.snapshot().phase).toBe('connecting'); call.mute(); expect(track.enabled).toBe(false); call.mute(); expect(track.enabled).toBe(true);
    call.end(); call.dispose(); expect(track.stop).toHaveBeenCalledOnce(); expect(s.listeners.get('room-expired')?.size).toBe(1);
  });
  it('cleans up on socket loss and never resumes a stale call after reconnect',async () => {
    const s = signaling(); const call = new VoiceCall(s.socket,'TEST1234'); call.attach(); await call.invite(); s.emit('call:outgoing',{ callId: 'id',roomCode: 'TEST1234' });
    s.emit('disconnect','transport close'); expect(call.snapshot().phase).toBe('ended'); s.emit('connect',undefined); expect(call.snapshot().phase).toBe('ended'); call.dispose();
  });
  it('dismisses missed calls and ignores unrelated signaling',() => {
    const s = signaling(); const call = new VoiceCall(s.socket,'TEST1234'); call.attach(); s.emit('call:incoming',{ callId: 'id',roomCode: 'OTHER123' }); expect(call.snapshot().phase).toBe('idle');
    s.emit('call:incoming',{ callId: 'id',roomCode: 'TEST1234' }); s.emit('call:timeout',{ callId: 'id',reason: 'no-answer' }); expect(call.snapshot().message).toBe('Missed Call'); call.dismiss(); expect(call.snapshot().phase).toBe('idle'); call.dispose();
  });
  it('prevents impossible state transitions',() => { expect(callTransitions.idle).not.toContain('connected'); expect(callTransitions.ended).toEqual(['idle']); });
});
