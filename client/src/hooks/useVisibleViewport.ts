import { useLayoutEffect, useState, type CSSProperties } from 'react';

// Safari's on-screen keyboard changes the visual viewport independently of dvh.
// Keep pinch zoom native: only resize application chrome at normal page scale.
export const useVisibleViewport = (): CSSProperties => {
  const [viewport, setViewport] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const visible = window.visualViewport;
    if (!visible) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = visible.scale === 1 ? `${visible.height}px` : undefined;
      const top = visible.scale === 1 ? `${visible.offsetTop}px` : undefined;
      setViewport(previous => previous.height === height && previous.top === top ? previous : { height, top });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    visible.addEventListener('resize', schedule);
    visible.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      visible.removeEventListener('resize', schedule);
      visible.removeEventListener('scroll', schedule);
    };
  }, []);
  return viewport;
};
