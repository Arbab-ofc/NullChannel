import type { Server } from 'socket.io';

let ioRef: Server | null = null;

export const setSocketServer = (io: Server) => {
  ioRef = io;
};

export const emitRoomExpired = (roomId: string, payload: { reason: string }) => {
  ioRef?.to(roomId).emit('room-expired', payload);
};
