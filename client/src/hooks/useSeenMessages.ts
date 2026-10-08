import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
type SeenMessage = { id?: string; sender_id: string; burn_after_read?: boolean; deleted?: boolean };
/** Visibility is a foreground, focused viewing interval, not delivery or history retrieval. */
export const useSeenMessages = (container: HTMLElement | null, code: string, identity: string, messages: SeenMessage[], joined: boolean) => {
  const tracker = useRef<{ sync: (messages: SeenMessage[]) => void } | null>(null);
  useEffect(() => {
    const root = container; if (!root || !joined) return;
    const pending = new Map<string,ReturnType<typeof setTimeout>>();
    const sent = new Set<string>(); const visible = new Set<HTMLElement>(); const observed = new Map<string,HTMLElement>();
    let disposed = false;
    const cancel = () => { for (const timer of pending.values()) clearTimeout(timer); pending.clear(); };
    const schedule = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) { cancel(); return; }
      for (const node of visible) {
        const id = node.dataset.messageId!;
        if (sent.has(id) || pending.has(id)) continue;
        pending.set(id,setTimeout(() => {
          pending.delete(id);
          if (!visible.has(node) || document.visibilityState !== 'visible' || !document.hasFocus()) return;
          sent.add(id);
          void api.post(`/rooms/${code}/messages/${id}/burn-read`,{}).catch(() => {
            sent.delete(id);
            if (!disposed && visible.has(node)) pending.set(id,setTimeout(() => { pending.delete(id); schedule(); },3000));
          });
        },1000));
      }
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const node = entry.target as HTMLElement;
        if (entry.isIntersecting && entry.intersectionRect.height >= Math.min(entry.boundingClientRect.height,root.clientHeight)*0.5) visible.add(node);
        else { visible.delete(node); const id = node.dataset.messageId!; clearTimeout(pending.get(id)); pending.delete(id); }
      }
      schedule();
    },{ root,threshold: [0,0.1,0.25,0.5,0.75,1] });
    tracker.current = { sync: items => {
      const eligible = new Set(items.filter(m => m.id && m.burn_after_read && !m.deleted && m.sender_id !== identity).map(m => m.id));
      for (const [id,node] of observed) if (!eligible.has(id) || !node.isConnected) { observer.unobserve(node); observed.delete(id); visible.delete(node); clearTimeout(pending.get(id)); pending.delete(id); }
      for (const node of root.querySelectorAll<HTMLElement>('[data-message-id]')) {
        const id = node.dataset.messageId!; if (eligible.has(id) && !observed.has(id)) { observed.set(id,node); observer.observe(node); }
      }
    } };
    document.addEventListener('visibilitychange',schedule); window.addEventListener('focus',schedule); window.addEventListener('blur',cancel);
    return () => { disposed = true; tracker.current = null; cancel(); observer.disconnect(); document.removeEventListener('visibilitychange',schedule); window.removeEventListener('focus',schedule); window.removeEventListener('blur',cancel); };
  },[container,code,identity,joined]);
  useEffect(() => tracker.current?.sync(messages),[messages,joined,code,container]);
};
