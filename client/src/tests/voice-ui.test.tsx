// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VoiceCallButton, VoiceCallUI } from '../components/call/VoiceCallUI';
import type { CallView, VoiceCall } from '../lib/voice-call';
let root: Root; let container: HTMLDivElement;
const view: CallView = { phase: 'idle',callId: null,peerName: 'Alice',roomName: 'Test',muted: false,playbackBlocked: false,connectedAt: null,message: '',accepting: false };
const actions = { accept: vi.fn(),reject: vi.fn(),end: vi.fn(),mute: vi.fn(),play: vi.fn(),dismiss: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('renders a keyboard-accessible call button and disables unavailable or busy calls',async () => {
  await act(async () => root.render(<VoiceCallButton view={view} available={false} disabled={false} start={actions.accept} />));
  expect(container.querySelector('button')?.disabled).toBe(true); expect(container.querySelector('button')?.getAttribute('aria-label')).toContain('waiting');
  await act(async () => root.render(<VoiceCallButton view={view} available disabled={false} start={actions.accept} />));
  expect(container.querySelector('button')?.disabled).toBe(false); await act(async () => container.querySelector('button')!.click()); expect(actions.accept).toHaveBeenCalledOnce();
});
it('shows incoming caller, room and explicit accept/decline controls in a labelled dialog',async () => {
  await act(async () => root.render(<VoiceCallUI view={{ ...view,phase: 'incoming' }} call={actions as unknown as VoiceCall} microphoneBusy={false} />));
  expect(container.querySelector('dialog')?.getAttribute('aria-labelledby')).toBe('voice-call-title'); expect(container.textContent).toContain('Alice');
  const buttons = container.querySelectorAll('button'); await act(async () => { buttons[0].click(); buttons[1].click(); }); expect(actions.accept).toHaveBeenCalledOnce(); expect(actions.reject).toHaveBeenCalledOnce();
});
it('has mobile-sized controls, mute state, playback recovery and call duration',async () => {
  vi.useFakeTimers(); await act(async () => root.render(<VoiceCallUI view={{ ...view,phase: 'connected',connectedAt: Date.now()-65000,playbackBlocked: true,muted: true }} call={actions as unknown as VoiceCall} microphoneBusy={false} />));
  expect(container.textContent).toContain('01:05'); expect(container.querySelector('[aria-label="Unmute microphone"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('section')?.className).toContain('safe-area-inset-bottom');
  await act(async () => vi.advanceTimersByTime(1000)); expect(container.textContent).toContain('01:06');
  const audioButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Tap to enable audio')!; await act(async () => audioButton.click()); expect(actions.play).toHaveBeenCalledOnce();
});
