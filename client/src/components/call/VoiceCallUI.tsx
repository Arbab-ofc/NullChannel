import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, X } from 'lucide-react';
import { Button } from '../common/Button';
import { callIsActive, type VoiceCall, type CallView } from '../../lib/voice-call';

export const VoiceCallButton = ({ view, available, disabled, start }: { view: CallView; available: boolean; disabled: boolean; start: () => void }) => (
  <Button className="min-h-11 min-w-11 shrink-0 px-3 text-cyan" aria-label={available ? 'Start voice call' : 'Voice call unavailable: waiting for the other participant'}
    title={available ? 'Start voice call' : 'The other participant must be online'} onClick={start} disabled={!available || disabled || callIsActive(view.phase)}>
    <Phone className="inline h-4 w-4" /><span className="ml-2 hidden sm:inline">{view.phase === 'outgoing' ? 'Calling…' : view.phase === 'connecting' ? 'Connecting…' : 'Voice'}</span>
  </Button>
);
const duration = (seconds: number) => `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
export const VoiceCallUI = ({ view, call, microphoneBusy }: { view: CallView; call: VoiceCall; microphoneBusy: boolean }) => {
  const [seconds,setSeconds] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const incoming = view.phase === 'incoming';
  useEffect(() => {
    if (!incoming) return;
    const element = dialog.current; const focus = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); focus?.focus(); };
  },[incoming]);
  useEffect(() => {
    if (view.connectedAt === null) return;
    const tick = () => setSeconds(Math.floor((Date.now()-view.connectedAt!)/1000));
    tick(); const timer = window.setInterval(tick,1000); return () => window.clearInterval(timer);
  },[view.connectedAt]);
  if (view.phase === 'idle') return null;
  if (incoming) return <dialog ref={dialog} aria-labelledby="voice-call-title" aria-describedby="voice-call-privacy"
    className="neo-panel m-auto max-h-[90svh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto bg-panel p-5 text-text backdrop:bg-black/70"
    onCancel={event => { event.preventDefault(); if (!view.accepting) void call.reject(); }}>
    <h2 id="voice-call-title" className="code-font text-lg text-cyan">Incoming Voice Call</h2>
    <p className="mt-3 break-words font-semibold">{view.peerName}</p><p className="break-words text-sm text-muted">{view.roomName}</p>
    <p id="voice-call-privacy" className="mt-3 text-xs text-muted">Audio only. No recording. Peer-to-peer calling may reveal your network address to the other participant.</p>
    {microphoneBusy && <p role="status" className="mt-3 text-sm text-punch">Finish your voice message recording before accepting.</p>}
    <div className="mt-5 flex flex-wrap gap-3">
      <Button className="min-h-12 flex-1 border-cyan text-cyan" disabled={view.accepting || microphoneBusy} onClick={() => void call.accept()}><Phone className="mr-2 inline h-4 w-4" />{view.accepting ? 'Opening microphone…' : 'Accept'}</Button>
      <Button className="min-h-12 flex-1 border-punch text-punch" disabled={view.accepting} onClick={() => void call.reject()}><PhoneOff className="mr-2 inline h-4 w-4" />Decline</Button>
    </div>
    {view.accepting && <Button className="mt-3 min-h-11 w-full" onClick={() => call.end()}>Cancel</Button>}
  </dialog>;
  const active = callIsActive(view.phase);
  const status: Record<string,string> = { outgoing: 'Calling…',connecting: 'Connecting voice…',connected: 'Voice Call Connected',reconnecting: 'Reconnecting voice…',ended: 'Call ended',failed: 'Call failed' };
  return <section aria-label="Voice call" className="neo-panel mx-2 my-2 max-h-[40svh] shrink-0 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mx-0 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1"><p role="status" aria-live="polite" className="code-font text-sm text-cyan">{status[view.phase]}</p>
        <p className="break-words text-sm">{view.peerName}</p>
        {view.connectedAt !== null && active && <p aria-label="Call duration" className="code-font text-sm text-muted">{duration(seconds)}</p>}
        {!active && <p role="alert" className="mt-1 text-sm text-muted">{view.message}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {['connected','connecting','reconnecting'].includes(view.phase) && <Button className="min-h-12 min-w-12 px-3" aria-label={view.muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={view.muted} onClick={() => call.mute()}>{view.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</Button>}
        {active ? <Button className="min-h-12 border-punch px-3 text-punch" aria-label="End voice call" onClick={() => call.end()}><PhoneOff className="h-5 w-5" /></Button> : <Button className="min-h-12 px-3" aria-label="Dismiss call status" onClick={() => call.dismiss()}><X className="h-5 w-5" /></Button>}
      </div>
    </div>
    {view.playbackBlocked && <Button className="mt-3 min-h-12 w-full border-cyan" onClick={() => call.play()}>Tap to enable audio</Button>}
    {active && <p className="mt-2 text-xs text-muted">{view.phase === 'reconnecting' ? 'Network interrupted; attempting to reconnect.' : 'Audio only • No recording • Peers may see your network address'}</p>}
  </section>;
};
