// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { TranscriptScroll } from '../lib/transcript-scroll';
let element: HTMLElement; let scroll: TranscriptScroll; let notify: ReturnType<typeof vi.fn<(count: number) => void>>;
let height: number; let positions: Record<string,number>;
beforeEach(() => {
  element = document.createElement('section'); height = 1000; positions = { a: 100,b: 200,c: 300 };
  Object.defineProperty(element,'scrollHeight',{ get: () => height }); Object.defineProperty(element,'clientHeight',{ value: 200 });
  element.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
  for (const id of ['a','b','c']) { const node = document.createElement('article'); node.dataset.messageId = id; node.getBoundingClientRect = () => ({ top: positions[id]-element.scrollTop,bottom: positions[id]+100-element.scrollTop } as DOMRect); element.append(node); }
  notify = vi.fn(); scroll = new TranscriptScroll(element,notify); scroll.sync(['a','b','c']);
});
it('follows new messages at bottom without scrolling the document',() => { scroll.beforeMessage('d',false); height = 1100; scroll.sync(['a','b','c','d']); expect(element.scrollTop).toBe(1100); });
it('preserves an older reading position and counts three distinct incoming messages',() => {
  element.scrollTop = 150; scroll.onScroll(); for (const id of ['d','e','f','f']) scroll.beforeMessage(id,false);
  height += 300; scroll.sync(['a','b','c','d','e','f']); expect(element.scrollTop).toBe(150); expect(notify).toHaveBeenLastCalledWith(3);
});
it('clears unread on explicit newest and manual bottom scrolling',() => {
  element.scrollTop = 150; scroll.onScroll(); scroll.beforeMessage('d',false); scroll.newest(); expect(notify).toHaveBeenLastCalledWith(0);
  element.scrollTop = 150; scroll.onScroll(); scroll.beforeMessage('e',false); element.scrollTop = 800; scroll.onScroll(); expect(notify).toHaveBeenLastCalledWith(0);
});
it('anchors visible content when an image above it loads or a message above it expires',() => {
  element.scrollTop = 150; scroll.onScroll(); positions.a += 90; positions.b += 90; positions.c += 90; height += 90; scroll.restore(); expect(element.scrollTop).toBe(240);
  positions.b -= 100; positions.c -= 100; height -= 100; element.firstElementChild!.remove(); scroll.sync(['b','c']); expect(element.scrollTop).toBe(140);
});
it('follows own messages and does not count an expired unread message',() => {
  element.scrollTop = 150; scroll.onScroll(); scroll.beforeMessage('d',false); scroll.sync(['a','b','c']); expect(notify).toHaveBeenLastCalledWith(0);
  scroll.beforeMessage('own',true); height += 100; scroll.sync(['a','b','c','own']); expect(element.scrollTop).toBe(height);
});
