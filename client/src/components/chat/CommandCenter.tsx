import type { ReactNode } from 'react';
import { NavigationOverlay } from '../common/NavigationOverlay';
export const CommandCenter = ({ open, close, code, children, immediate = false }: { open: boolean; close: () => void; code: string; children: ReactNode; immediate?: boolean }) =>
  <NavigationOverlay id="chat-command-center" title="SESSION CONTROLS" code={code} open={open} close={close} immediate={immediate}>{children}</NavigationOverlay>;
