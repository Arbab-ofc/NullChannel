import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useVisibleViewport } from '../../hooks/useVisibleViewport';

export const NavigationOverlay = ({ id, title, code, open, close, children, immediate = false }: {
  id: string; title: string; code?: string; open: boolean; close: () => void; children: ReactNode; immediate?: boolean;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const restore = useRef<((focus: boolean) => void) | null>(null);
  const viewport = useVisibleViewport();
  useEffect(() => {
    const element = dialog.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open && !element.open) {
      const origin = document.activeElement as HTMLElement | null;
      const body = document.body;
      const { overflow, paddingRight } = body.style;
      const x = window.scrollX, y = window.scrollY;
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      if (gutter > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gutter}px`;
      body.style.overflow = 'hidden';
      restore.current = focus => {
        body.style.overflow = overflow;
        body.style.paddingRight = paddingRight;
        window.scrollTo({ left: x, top: y, behavior: 'instant' });
        if (focus && origin?.isConnected) origin.focus({ preventScroll: true });
        restore.current = null;
      };
      element.showModal();
      element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    } else if (!open && element.open) {
      const finish = () => { element.close(); restore.current?.(!immediate); };
      if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
      else timer = setTimeout(finish, 300);
    }
    const resize = () => { if (open && window.innerWidth >= 1280) close(); };
    window.addEventListener('resize', resize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', resize); };
  }, [open, close, immediate]);
  useEffect(() => {
    const element = dialog.current!;
    return () => { if (element.open) element.close(); restore.current?.(true); };
  }, []);
  // Keep page spacing utilities out of the full-screen dialog's geometry.
  return createPortal(<dialog ref={dialog} id={id} style={viewport} tabIndex={-1} autoFocus aria-labelledby={`${id}-title`}
    className={`navigation-overlay ${open ? 'is-open' : ''}`}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]'))
        .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="navigation-overlay__surface">
      <div className="navigation-overlay__content">
        <header className="navigation-overlay__header">
          <div><p className="code-font text-xs tracking-widest text-cyan">NULLCHANNEL</p>
            <h2 id={`${id}-title`}>{title}</h2>
            <p className="code-font text-xs text-muted">{code ? `CHANNEL ${code}` : 'Private conversations. Temporary connections.'}</p>
          </div>
          <button type="button" className="navigation-overlay__close neo-action" aria-label={code ? 'Close session controls' : 'Close navigation'} onClick={close}><X aria-hidden="true" /></button>
        </header>
        <nav aria-label={title} className="navigation-overlay__groups">{children}</nav>
        <p className="navigation-overlay__signature code-font">YOUR CHANNEL. YOUR CONTROL.</p>
      </div>
    </div>
  </dialog>, document.body);
};
