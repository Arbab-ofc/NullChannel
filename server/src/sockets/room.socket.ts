import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { socketMessageSchema } from '../schemas/message.schema.js';
import { getRoomByCode } from '../services/room.service.js';
import { saveMessage } from '../services/message.service.js';
import { joinMembership, leaveMembership } from '../services/membership.service.js';

const joinSchema = z.object({ roomCode: z.string().length(8), senderId: z.string().uuid(), senderName: z.string().trim().min(2).max(24).optional() });
const leaveSchema = z.object({ roomCode: z.string().length(8), senderId: z.string().uuid() });

export const registerRoomSocket = (io: Server, socket: Socket) => {
  socket.on('join-room', async (payload) => {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) return socket.emit('socket-error', { code: 'VALIDATION_ERROR', message: 'Invalid join payload.' });

    const room = await getRoomByCode(parsed.data.roomCode.toUpperCase());
    if (!room) return socket.emit('socket-error', { code: 'ROOM_NOT_FOUND', message: 'Channel not found or expired.' });
    if (room.room_type === 'group' && !parsed.data.senderName) {
      return socket.emit('socket-error', { code: 'NAME_REQUIRED', message: 'Display name is required for group room.' });
    }
    const effectiveName = parsed.data.senderName ?? `User-${parsed.data.senderId.slice(0, 6)}`;

    socket.join(room.id);
    await joinMembership(room.id, parsed.data.senderId, effectiveName);
    socket.emit('room-joined', room);
  });

  socket.on('send-message', async (payload) => {
    const parsed = socketMessageSchema.safeParse(payload);
    if (!parsed.success) return socket.emit('socket-error', { code: 'VALIDATION_ERROR', message: 'Invalid message payload.' });

    const room = await getRoomByCode(parsed.data.roomCode);
    if (!room) return socket.emit('room-expired', { message: 'Channel terminated.' });
    if (room.room_type === 'group' && !parsed.data.senderName) {
      return socket.emit('socket-error', { code: 'NAME_REQUIRED', message: 'Display name is required for group room.' });
    }
    const effectiveName = parsed.data.senderName ?? `User-${parsed.data.senderId.slice(0, 6)}`;

    const message = await saveMessage(room.id, {
      roomCode: parsed.data.roomCode,
      senderId: parsed.data.senderId,
      senderName: effectiveName,
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

  socket.on('leave-room', async (payload) => {
    const parsed = leaveSchema.safeParse(payload);
    if (!parsed.success) return;
    const room = await getRoomByCode(parsed.data.roomCode.toUpperCase());
    if (!room) return;
    socket.leave(room.id);
    await leaveMembership(room.id, parsed.data.senderId);
  });
};
