import { useEffect } from 'react';
import { socket, connectSocket, disconnectSocket } from '../lib/socket';
export const useSocket = (roomCode: string) => {
  useEffect(() => {
    if (!socket.connected) connectSocket();
    return () => { disconnectSocket(); };
  }, [roomCode]);
  return socket;
};
