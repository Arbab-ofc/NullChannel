import { useMemo } from 'react';

export const useLocalSender = () => useMemo(() => {
  const key = 'nullchannel_sender_id';
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}, []);
