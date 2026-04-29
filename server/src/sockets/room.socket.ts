import type { Server, Socket } from 'socket.io';
import { socketMessageSchema } from '../schemas/message.schema.js';
import { getRoomByCode } from '../services/room.service.js';
import { saveMessage } from '../services/message.service.js';

export const registerRoomSocket = (io: Server, socket: Socket) => {
  socket.on('join-room', async ({ roomCode }) => {
    const room = await getRoomByCode(String(roomCode).toUpperCase());
    if (!room) return socket.emit('socket-error', { code: 'ROOM_NOT_FOUND', message: 'Channel not found or expired.' });
    socket.join(room.id);
    socket.emit('room-joined', room);
  });

  socket.on('send-message', async (payload) => {
    const parsed = socketMessageSchema.safeParse(payload);
    if (!parsed.success) return socket.emit('socket-error', { code: 'VALIDATION_ERROR', message: 'Invalid message payload.' });

    const room = await getRoomByCode(parsed.data.roomCode);
    if (!room) return socket.emit('room-expired', { message: 'Channel terminated.' });

    const message = await saveMessage(room.id, {
      roomCode: parsed.data.roomCode,
      senderId: parsed.data.senderId,
      type: parsed.data.type,
      content: parsed.data.content,
      fileUrl: parsed.data.fileUrl,
      filePath: parsed.data.filePath
    });

    io.to(room.id).emit('receive-message', message);
  });

  socket.on('typing', ({ roomCode, senderId }) => {
    socket.broadcast.emit('user-typing', { roomCode, senderId });
  });

  socket.on('leave-room', (roomId: string) => socket.leave(roomId));
};
