import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { registerRoomSocket } from './room.socket.js';

export const createSocketServer = (server: HttpServer) => {
  const io = new Server(server, {
    cors: { origin: env.CLIENT_URL }
  });

  io.on('connection', (socket) => {
    socket.emit('connection-status', { connected: true });
    registerRoomSocket(io, socket);
  });

  return io;
};
