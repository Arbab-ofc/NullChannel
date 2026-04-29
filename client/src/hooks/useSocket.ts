import { useEffect } from 'react';
import { socket } from '../lib/socket';

export const useSocket = () => {
  useEffect(() => {
    if (!socket.connected) socket.connect();
    return () => { socket.off(); };
  }, []);
  return socket;
};
