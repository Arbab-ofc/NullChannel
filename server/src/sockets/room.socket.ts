import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { socketMessageSchema } from '../schemas/message.schema.js';
import { getRoomByCode } from '../services/room.service.js';
import { getMessageById, saveMessage } from '../services/message.service.js';
import { countActiveMembers, isActiveMember, joinMembership, leaveMembership } from '../services/membership.service.js';

const joinSchema = z.object({ roomCode: z.string().length(8), senderId: z.string().uuid(), senderName: z.string().trim().min(2).max(24) });
const leaveSchema = z.object({ roomCode: z.string().length(8), senderId: z.string().uuid(), senderName: z.string().trim().min(2).max(24).optional() });
const typingSchema = z.object({ roomCode: z.string().length(8), senderId: z.string().uuid(), senderName: z.string().trim().min(2).max(24).optional() });

export const registerRoomSocket = (io: Server, socket: Socket) => {
  socket.on('join-room', async (payload) => {
    try {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return socket.emit('socket-error', { code: 'VALIDATION_ERROR', message: 'Invalid join payload.' });

      const room = await getRoomByCode(parsed.data.roomCode.toUpperCase());
      if (!room) return socket.emit('socket-error', { code: 'ROOM_NOT_FOUND', message: 'Channel not found or expired.' });
      let alreadyActive = false;
      try {
        alreadyActive = await isActiveMember(room.id, parsed.data.senderId);
      } catch {
        alreadyActive = false;
      }
      if (room.room_type === 'private') {
        try {
          if (!alreadyActive) {
            const activeCount = await countActiveMembers(room.id);
            if (activeCount >= 2) {
              return socket.emit('socket-error', { code: 'ROOM_FULL', message: 'Private channel allows only 2 active users.' });
            }
          }
        } catch {
          // Do not block join if membership checks fail unexpectedly.
        }
      }
      await joinMembership(room.id, parsed.data.senderId, parsed.data.senderName);
      socket.join(room.id);
      socket.join(`room-code:${room.code}`);
      socket.emit('room-joined', room);
      if (!alreadyActive) {
        socket.to(room.id).emit('user-joined', { senderId: parsed.data.senderId, senderName: parsed.data.senderName, roomCode: room.code });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to join room right now.';
      if (message.includes('room_members') || message.includes('sender_name')) {
        socket.emit('socket-error', {
          code: 'DB_SCHEMA_OUTDATED',
          message: 'Database schema is outdated. Run docs/supabase-migration-v3.sql and retry.'
        });
        return;
      }
      socket.emit('socket-error', { code: 'SOCKET_JOIN_FAILED', message });
    }
  });

  socket.on('send-message', async (payload) => {
    try {
      const parsed = socketMessageSchema.safeParse(payload);
      if (!parsed.success) return socket.emit('socket-error', { code: 'VALIDATION_ERROR', message: 'Invalid message payload.' });

      const room = await getRoomByCode(parsed.data.roomCode);
      if (!room) return socket.emit('room-expired', { message: 'Channel terminated.' });
      const activeMember = await isActiveMember(room.id, parsed.data.senderId);
      if (!activeMember) {
        return socket.emit('socket-error', { code: 'JOIN_REQUIRED', message: 'Join this channel before sending messages.' });
      }
      if (!parsed.data.senderName) {
        return socket.emit('socket-error', { code: 'NAME_REQUIRED', message: 'Display name is required for this room.' });
      }
      const effectiveName = parsed.data.senderName ?? `User-${parsed.data.senderId.slice(0, 6)}`;
      if (parsed.data.replyToMessageId) {
        const replyTo = await getMessageById(parsed.data.replyToMessageId);
        if (!replyTo || replyTo.room_id !== room.id) {
          return socket.emit('socket-error', { code: 'REPLY_NOT_FOUND', message: 'Quoted message was not found.' });
        }
      }

      const message = await saveMessage(room.id, {
        roomCode: parsed.data.roomCode,
        senderId: parsed.data.senderId,
        senderName: effectiveName,
        type: parsed.data.type,
        content: parsed.data.content,
        fileUrl: parsed.data.fileUrl,
        filePath: parsed.data.filePath,
        fileName: parsed.data.fileName,
        fileSize: parsed.data.fileSize,
        mimeType: parsed.data.mimeType,
        replyToMessageId: parsed.data.replyToMessageId
      });

      io.to(room.id).emit('receive-message', message);
    } catch {
      socket.emit('socket-error', { code: 'SEND_FAILED', message: 'Message send failed.' });
    }
  });

  socket.on('typing', async (payload) => {
    try {
      const parsed = typingSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = await getRoomByCode(parsed.data.roomCode.toUpperCase());
      if (!room) return;
      const activeMember = await isActiveMember(room.id, parsed.data.senderId);
      if (!activeMember) return;
      socket.to(room.id).emit('user-typing', {
        roomCode: room.code,
        senderId: parsed.data.senderId,
        senderName: parsed.data.senderName
      });
    } catch {
      // Typing indicators are non-critical and should not interrupt chat.
    }
  });

  socket.on('leave-room', async (payload) => {
    try {
      const parsed = leaveSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = await getRoomByCode(parsed.data.roomCode.toUpperCase());
      if (!room) return;
      const effectiveName = parsed.data.senderName ?? `User-${parsed.data.senderId.slice(0, 6)}`;
      socket.leave(room.id);
      socket.leave(`room-code:${room.code}`);
      await leaveMembership(room.id, parsed.data.senderId);
      socket.to(room.id).emit('user-left', { senderId: parsed.data.senderId, senderName: effectiveName, roomCode: room.code });
    } catch {
      socket.emit('socket-error', { code: 'LEAVE_FAILED', message: 'Unable to leave room right now.' });
    }
  });
};
