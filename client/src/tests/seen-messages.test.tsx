// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { post } = vi.hoisted(() => ({ post: vi.fn(async () => ({})) }));
vi.mock('../lib/api',() => ({ api: { post } }));
import { useSeenMessages } from '../hooks/useSeenMessages';
let callback: IntersectionObserverCallback; let root: Root; let host: HTMLElement; let transcript: HTMLElement;
const messages = [{ id: 'message',sender_id: 'other',burn_after_read: true }];
let ref: { current: HTMLElement | null };
const Fixture = ({ extra = false }: { extra?: boolean }) => { useSeenMessages(ref.current,'TEST1234','self',extra ? [...messages,{ id: 'new',sender_id: 'other',burn_after_read: true }] : messages,true); return null; };
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.spyOn(document,'hasFocus').mockReturnValue(true); Object.defineProperty(document,'visibilityState',{ configurable: true,value: 'visible' });
  vi.stubGlobal('IntersectionObserver',class { constructor(cb: IntersectionObserverCallback) { callback = cb; } observe() {} unobserve() {} disconnect() {} });
  host = document.createElement('div'); transcript = document.createElement('section'); Object.defineProperty(transcript,'clientHeight',{ value: 200 });
  const article = document.createElement('article'); article.dataset.messageId = 'message'; transcript.append(article); document.body.append(host,transcript);
  ref = { current: transcript }; root = createRoot(host); await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); transcript.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const visibility = (visible: boolean) => callback([{ target: transcript.firstElementChild,isIntersecting: visible,intersectionRect: { height: visible ? 100 : 0 },boundingClientRect: { height: 100 } } as unknown as IntersectionObserverEntry],{} as IntersectionObserver);
it('does not count delivery or hidden/offscreen content as seen',async () => {
  await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(post).not.toHaveBeenCalled();
  visibility(true); window.dispatchEvent(new Event('blur')); await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(post).not.toHaveBeenCalled();
});
it('sends a receipt only after a focused visible interval and does not reset on incoming messages',async () => {
  visibility(true); await act(async () => vi.advanceTimersByTimeAsync(500)); await act(async () => root.render(<Fixture extra />));
  await act(async () => vi.advanceTimersByTimeAsync(500)); expect(post).toHaveBeenCalledWith('/rooms/TEST1234/messages/message/burn-read',{ viewProtocol: 'focused-viewport-v1' });
  visibility(true); await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(post).toHaveBeenCalledOnce();
});
it('cancels the viewing interval when a message leaves view',async () => {
  visibility(true); await act(async () => vi.advanceTimersByTimeAsync(500)); visibility(false); await act(async () => vi.advanceTimersByTimeAsync(1500)); expect(post).not.toHaveBeenCalled();
  visibility(true); await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(post).toHaveBeenCalledOnce();
});
