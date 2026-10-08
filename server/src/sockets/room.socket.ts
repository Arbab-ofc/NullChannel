import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { socketMessageSchema } from '../schemas/message.schema.js';
import { getRoomByCode } from '../services/room.service.js';
import { getMessageById, saveMessage } from '../services/message.service.js';
import { isActiveMember, joinMembership, leaveMembership } from '../services/membership.service.js';

import { supabase } from '../config/supabase.js';
import { emitPresence, revokeRoomSockets } from './emitter.js';
import { allowEvent } from './rateLimit.js';
import { env } from '../config/env.js';

const joinSchema = z.strictObject({ roomCode: z.string().length(8), senderId: z.string().uuid(), senderName: z.string().trim().min(2).max(24) });
const leaveSchema = z.strictObject({ roomCode: z.string().length(8), senderId: z.string().uuid(), senderName: z.string().trim().min(2).max(24).optional() });
const typingSchema = z.strictObject({ roomCode: z.string().length(8), senderId: z.string().uuid(), senderName: z.string().trim().min(2).max(24).optional() });

export const registerRoomSocket = (io: Server, socket: Socket) => {
  socket.on('disconnecting', () => {
    const roomIds = [...socket.rooms].filter(room => /^[0-9a-f-]{36}$/i.test(room));
    setImmediate(() => { for (const roomId of roomIds) void emitPresence(roomId).catch(() => undefined); });
  });
  socket.use(async ([event, payload, acknowledgement], next) => {
    try {
      const limits: Record<string, number> = { 'join-room': env.SOCKET_JOIN_LIMIT, 'send-message': env.SOCKET_MESSAGE_LIMIT, typing: env.SOCKET_TYPING_LIMIT, 'leave-room': 30 };
      const calling = ['call:invite','call:accept','call:reject','call:offer','call:answer','call:ice-candidate','call:end','call:connected','call:reconnecting'].includes(event);
      if (calling && !allowEvent(`${socket.data.identity}:call-packets`,env.CALL_SIGNAL_LIMIT*2)) {
        const failure = { ok: false,code: 'RATE_LIMITED',message: 'Too many call events. Please wait.' };
        if (typeof acknowledgement === 'function') acknowledgement(failure);
        socket.emit('call:error',failure); return;
      }
      if (!calling && (!limits[event] || !allowEvent(`${socket.data.identity}:${event}`, limits[event]))) {
        socket.emit('socket-error', { code: 'RATE_LIMITED', message: 'Too many events. Please wait.' }); return;
      }
      const { data, error } = await supabase.from('anonymous_sessions').select('id').eq('id', socket.data.sessionId).is('revoked_at', null).gt('expires_at', new Date().toISOString()).gt('access_expires_at', new Date().toISOString()).maybeSingle();
      if (error || !data) { socket.emit('socket-error', { code: 'SESSION_EXPIRED', message: 'Renew your session.' }); socket.disconnect(true); return; }
      if (!calling && payload && typeof payload === 'object' && !Array.isArray(payload)) payload.senderId = socket.data.identity;
      next();
    } catch { socket.emit('socket-error', { code: 'SESSION_UNAVAILABLE', message: 'Session verification failed.' }); }
  });
  socket.on('join-room', async (payload) => {
    try {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return socket.emit('socket-error', { code: 'VALIDATION_ERROR', message: 'Invalid join payload.' });

      const room = await getRoomByCode(parsed.data.roomCode.toUpperCase());
      if (!room) return socket.emit('socket-error', { code: 'ROOM_NOT_FOUND', message: 'Channel not found or expired.' });
      const alreadyActive = await isActiveMember(room.id, socket.data.identity);
      await joinMembership(room.id, parsed.data.senderId, parsed.data.senderName);
      await socket.join(room.id);
      await socket.join(`room-code:${room.code}`);
      socket.emit('room-joined', room);
      await emitPresence(room.id);
      if (!alreadyActive) {
        socket.to(room.id).emit('user-joined', { senderId: parsed.data.senderId, senderName: parsed.data.senderName, roomCode: room.code });
      }
    } catch (error) {
      const full = String((error as { message?: string }).message).includes('ROOM_FULL');
      socket.emit('socket-error', { code: full ? 'ROOM_FULL' : 'SOCKET_JOIN_FAILED', message: full ? 'Private channel allows only 2 members.' : 'Unable to join channel.' });
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
        replyToMessageId: parsed.data.replyToMessageId,
        burnAfterRead: parsed.data.burnAfterRead
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
      await revokeRoomSockets(room.id, room.code, socket.data.identity);
      socket.to(room.id).emit('user-left', { senderId: parsed.data.senderId, senderName: effectiveName, roomCode: room.code });
    } catch {
      socket.emit('socket-error', { code: 'LEAVE_FAILED', message: 'Unable to leave room right now.' });
    }
  });
};
