import { useCountdown } from '../../hooks/useCountdown';
export const ExpiryCountdown = ({ expiresAt }: { expiresAt: string }) => {
  const left = useCountdown(expiresAt);
  return <div className="chat-expiry"><p className="code-font text-[9px] tracking-widest text-muted">EXPIRES IN</p><p className="code-font text-sm font-bold tabular-nums text-punch sm:text-lg">{left}</p></div>;
};
