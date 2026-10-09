// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NavigationOverlay } from '../components/common/NavigationOverlay';
let root: Root, host: HTMLDivElement;
let reduced = false;
const Fixture = () => {
  const [open,setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open navigation</button><NavigationOverlay id="test-navigation" title="Navigation" open={open} close={() => setOpen(false)}><button>Room action</button></NavigationOverlay></>;
};
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); reduced = false;
  vi.stubGlobal('matchMedia',() => ({ matches: reduced })); vi.stubGlobal('scrollTo',vi.fn());
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{ configurable: true,value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype,'close',{ configurable: true,value: function(this: HTMLDialogElement) { this.open = false; } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const open = async () => { const button = host.querySelector('button')!; button.focus(); await act(async () => button.click()); return button; };
it('locks scrolling, retains the dialog during slide-out, then restores focus and scrolling',async () => {
  const button = await open(); const dialog = document.querySelector('dialog')!;
  expect(dialog.open).toBe(true); expect(document.body.style.overflow).toBe('hidden');
  await act(async () => dialog.querySelector('button')!.click());
  expect(dialog.open).toBe(true); expect(dialog.classList.contains('is-open')).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(dialog.open).toBe(false); expect(document.body.style.overflow).toBe(''); expect(document.activeElement).toBe(button);
});
it('honors reduced motion and Escape cancellation',async () => {
  reduced = true; const button = await open(); const dialog = document.querySelector('dialog')!;
  await act(async () => dialog.dispatchEvent(new Event('cancel',{ cancelable: true })));
  expect(dialog.open).toBe(false); expect(document.activeElement).toBe(button);
});
it('releases the body lock when navigation unmounts',async () => {
  await open(); await act(async () => root.render(null)); expect(document.body.style.overflow).toBe('');
});
