import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Socket } from 'socket.io-client';
import { VoiceCall } from '../lib/voice-call';
export const useVoiceCall = (socket: Socket, code: string, eligible: boolean, expiresAt?: string) => {
  const call = useMemo(() => new VoiceCall(socket,code),[socket,code]);
  const view = useSyncExternalStore(call.subscribe,call.snapshot,call.snapshot);
  useEffect(() => {
    call.attach(); const hide = () => call.end(); window.addEventListener('pagehide',hide);
    return () => { window.removeEventListener('pagehide',hide); call.dispose(); };
  },[call]);
  useEffect(() => { call.setRoom(eligible,expiresAt); },[call,eligible,expiresAt]);
  return { call,view };
};
