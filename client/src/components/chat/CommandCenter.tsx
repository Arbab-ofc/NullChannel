import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export const CommandCenter = ({ open, close, code, children, immediate = false }: { open: boolean; close: () => void; code: string; children: ReactNode; immediate?: boolean }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const overflow = useRef('');
  useEffect(() => {
    const element = dialog.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      if (!element.open) { origin.current = document.activeElement as HTMLElement; overflow.current = document.body.style.overflow; element.showModal(); }
      document.body.style.overflow = 'hidden';
    } else if (element.open) {
      const finish = () => { element.close(); document.body.style.overflow = overflow.current; if (!immediate) origin.current?.focus(); };
      if (immediate) finish(); else timer = setTimeout(finish,300);
    }
    const resize = () => { if (open && window.innerWidth >= 1280) close(); };
    window.addEventListener('resize',resize);
    return () => { clearTimeout(timer); window.removeEventListener('resize',resize); };
  },[open,close,immediate]);
  useEffect(() => { const element = dialog.current!; return () => { if (element.open) { element.close(); document.body.style.overflow = overflow.current; origin.current?.focus(); } }; },[]);
  return <dialog ref={dialog} id="chat-command-center" aria-labelledby="command-center-title" className={`command-center ${open ? 'is-open' : ''}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="command-center__panel">
      <header className="flex items-start justify-between gap-3 border-b-2 border-accent/40 pb-4">
        <div><p className="code-font text-xs tracking-widest text-cyan">NULLCHANNEL</p><h2 id="command-center-title" className="mt-2 font-bold">SESSION CONTROLS</h2><p className="code-font mt-2 text-xs text-muted">CHANNEL {code}</p></div>
        <button type="button" className="neo-action flex h-11 w-11 shrink-0 items-center justify-center border-2 border-accent" aria-label="Close session controls" onClick={close}><X className="h-5 w-5" /></button>
      </header>
      {children}
    </div>
  </dialog>;
};
