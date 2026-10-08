export const CALL_DEFAULTS = { ringMs: 30000, connectMs: 20000, disconnectMs: 10000 };
export const NETWORK_FAILURE = 'Voice could not connect. This network may require a TURN relay; try another network.';
export const iceConfiguration = (value = import.meta.env.VITE_WEBRTC_STUN_URLS ?? 'stun:stun.l.google.com:19302'): RTCConfiguration => {
  const urls = value.split(',').map((url: string) => url.trim()).filter(Boolean);
  if (urls.length > 8 || urls.some((url: string) => !/^stuns?:[a-z0-9.-]+(?::\d{1,5})?$/i.test(url))) throw new Error('Invalid STUN configuration.');
  return { iceServers: urls.length ? [{ urls }] : [], bundlePolicy: 'max-bundle' };
};
export const microphoneError = (error: unknown) => {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const errors: Record<string,string> = {
    NotAllowedError: 'Microphone permission denied. Allow microphone access and try again.',
    NotFoundError: 'No microphone was found.', NotReadableError: 'The microphone is busy or unavailable.',
    OverconstrainedError: 'This microphone does not support the requested audio settings.',
    SecurityError: 'Microphone access is blocked. Use HTTPS and check browser permissions.'
  };
  return errors[name] ?? (error instanceof Error ? error.message : 'Unable to start microphone audio.');
};
export type AudioCallbacks = {
  description: (kind: 'offer' | 'answer', revision: number, sdp: string) => Promise<void>;
  candidate: (revision: number, candidate: RTCIceCandidateInit) => Promise<void>;
  state: (state: 'connected' | 'reconnecting') => void;
  error: (message: string) => void;
  playback: (blocked: boolean) => void;
};
export class AudioPeer {
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private ready: Promise<void> | null = null;
  private closed = false;
  private revision = 0;
  private remoteRevision = 0;
  private signaledRevision = 0;
  private candidates: Array<{ revision: number; candidate: RTCIceCandidateInit }> = [];
  private localCandidates: Array<{ revision: number; candidate: RTCIceCandidateInit }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private negotiating = false;
  private deviceListener = () => { if (this.audio?.srcObject) void this.play(); };
  constructor(private caller: boolean, private callbacks: AudioCallbacks,
    private config: RTCConfiguration = iceConfiguration(), private timeouts = CALL_DEFAULTS) {}
  start() {
    if (this.ready) return this.ready;
    this.ready = this.initialize(); return this.ready;
  }
  private async initialize() {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined' || !window.isSecureContext) throw new Error('Voice calling requires HTTPS and a browser with WebRTC microphone support.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    try {
      const pc = new RTCPeerConnection(this.config); this.pc = pc;
      const audio = document.createElement('audio'); this.audio = audio; audio.autoplay = true; audio.setAttribute('playsinline','');
      navigator.mediaDevices.addEventListener?.('devicechange',this.deviceListener);
      stream.getAudioTracks().forEach(track => { pc.addTrack(track,stream); track.onended = () => this.fail('The microphone was disconnected.'); });
      pc.ontrack = event => {
        if (this.closed || event.track.kind !== 'audio') return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]); void this.play();
      };
      pc.onicecandidate = event => {
        if (this.closed || !event.candidate || !this.revision) return;
        const candidate = event.candidate.toJSON();
        const ufrag = candidate.usernameFragment;
        if (ufrag && !pc.localDescription?.sdp.includes(`a=ice-ufrag:${ufrag}`)) return;
        if (this.localCandidates.length >= 256) return this.fail('Too many connection candidates.');
        if (this.signaledRevision === this.revision) void this.sendCandidate(this.revision,candidate);
        else this.localCandidates.push({ revision: this.revision,candidate });
      };
      pc.onconnectionstatechange = () => this.connectionChanged();
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') this.fail(NETWORK_FAILURE);
        else if (pc.iceConnectionState === 'disconnected') this.reconnecting();
      };
      this.deadline(this.timeouts.connectMs);
    } catch (error) { this.close(); throw error; }
  }
  private deadline(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.fail(NETWORK_FAILURE),ms); }
  private fail(message: string) { if (this.closed) return; this.close(); this.callbacks.error(message); }
  private async sendCandidate(revision: number, candidate: RTCIceCandidateInit) {
    try { if (!this.closed) await this.callbacks.candidate(revision,candidate); }
    catch { if (!this.closed) this.fail('Voice signaling was interrupted. Please call again.'); }
  }
  private connectionChanged() {
    if (this.closed || !this.pc) return;
    const state = this.pc.connectionState;
    if (state === 'connected') {
      if (this.timer) clearTimeout(this.timer); this.timer = null;
      this.callbacks.state('connected');
    } else if (state === 'disconnected') this.reconnecting();
    else if (state === 'failed') this.fail(NETWORK_FAILURE);
  }
  private recovering = false;
  private reconnecting() {
    if (this.closed || this.recovering) return;
    this.recovering = true; this.callbacks.state('reconnecting'); this.deadline(this.timeouts.disconnectMs);
    // A deterministic caller is the only offerer, including ICE restarts.
    if (this.caller) void this.offer(true).catch(() => this.fail(NETWORK_FAILURE));
  }
  async offer(restart = false) {
    await this.start(); if (this.closed || !this.pc || this.negotiating) return;
    if (this.revision >= 5) return this.fail(NETWORK_FAILURE);
    this.negotiating = true;
    try {
      this.revision += 1; this.signaledRevision = 0;
      const offer = await this.pc.createOffer({ iceRestart: restart }); if (this.closed) return;
      await this.pc.setLocalDescription(offer); if (this.closed) return;
      await this.callbacks.description('offer',this.revision,this.pc.localDescription!.sdp);
      if (!this.closed) await this.flushLocal();
    } finally { this.negotiating = false; }
  }
  async description(kind: 'offer' | 'answer', revision: number, sdp: string) {
    if (this.closed) return;
    if ((kind === 'offer' && this.caller) || (kind === 'answer' && !this.caller)) throw new Error('Invalid negotiation role.');
    if (kind === 'offer') {
      if (revision !== this.revision+1) throw new Error('Invalid offer sequence.'); this.revision = revision;
    } else if (revision !== this.revision) throw new Error('Invalid answer sequence.');
    await this.start(); if (this.closed || !this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: kind,sdp })); if (this.closed) return;
    this.remoteRevision = revision;
    const queued = this.candidates.splice(0);
    for (const item of queued) if (item.revision === revision) await this.pc.addIceCandidate(new RTCIceCandidate(item.candidate));
    if (kind === 'offer') {
      const answer = await this.pc.createAnswer(); if (this.closed) return;
      await this.pc.setLocalDescription(answer); if (this.closed) return;
      await this.callbacks.description('answer',revision,this.pc.localDescription!.sdp);
      if (!this.closed) await this.flushLocal();
    }
    this.recovering = false;
    if (!this.closed && this.pc?.connectionState === 'connected') this.connectionChanged();
  }
  private async flushLocal() {
    this.signaledRevision = this.revision;
    for (const item of this.localCandidates.splice(0)) if (item.revision === this.revision) await this.sendCandidate(item.revision,item.candidate);
  }
  async candidate(revision: number, candidate: RTCIceCandidateInit) {
    if (this.closed || revision < this.revision) return;
    if (revision > this.revision+1 || this.candidates.length >= 256) throw new Error('Invalid candidate sequence.');
    if (!this.pc?.remoteDescription || this.remoteRevision !== revision) this.candidates.push({ revision,candidate });
    else await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
  mute(muted: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  async play() {
    if (!this.audio || this.closed) return;
    try { await this.audio.play(); if (!this.closed) this.callbacks.playback(false); }
    catch { if (!this.closed) this.callbacks.playback(true); }
  }
  close() {
    if (this.closed) return; this.closed = true;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    navigator.mediaDevices?.removeEventListener?.('devicechange',this.deviceListener);
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = null;
    if (this.pc) { this.pc.ontrack = null; this.pc.onicecandidate = null; this.pc.onconnectionstatechange = null; this.pc.oniceconnectionstatechange = null; this.pc.close(); this.pc = null; }
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; this.audio.remove(); this.audio = null; }
    this.candidates = []; this.localCandidates = [];
  }
}
