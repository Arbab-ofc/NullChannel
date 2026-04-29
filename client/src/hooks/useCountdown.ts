import { useEffect, useState } from 'react';

export const useCountdown = (iso: string) => {
  const [left, setLeft] = useState('');
  useEffect(() => {
    const id = setInterval(() => {
      const ms = new Date(iso).getTime() - Date.now();
      if (ms <= 0) return setLeft('00:00:00');
      const h = Math.floor(ms / 3600000).toString().padStart(2, '0');
      const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
      const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
      setLeft(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return left;
};
