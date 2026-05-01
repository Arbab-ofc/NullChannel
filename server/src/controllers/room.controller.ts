import type { Request, Response } from 'express';
import { createRoom, extendRoomExpiry, getRoomByCode, pinRoomMessage, terminateRoom } from '../services/room.service.js';
import { deleteMessageById, getMessageById, listMessages, toggleMessageReaction, updateMessageContent } from '../services/message.service.js';
import { deleteMediaByFileId } from '../services/media.service.js';
import { successResponse, errorResponse } from '../utils/apiResponse.js';
import { createRoomSchema, extendRoomSchema, pinMessageSchema, senderParamSchema, terminateRoomSchema } from '../schemas/room.schema.js';
import { deleteMessageSchema, editMessageSchema, reactionSchema } from '../schemas/message.schema.js';
import { getActiveRoomsForSender, getParticipantsForRoom, leaveMembership } from '../services/membership.service.js';
import { emitMessageDeleted, emitMessageEdited, emitMessagePinned, emitMessageReactions, emitRoomExpired, emitRoomExpiredByCode, emitRoomExtended } from '../sockets/emitter.js';

export const createRoomController = async (req: Request, res: Response) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId, senderName, roomType, roomName and expiry are required.'));
    return;
  }
  try {
    const room = await createRoom(parsed.data.senderId, parsed.data.senderName, parsed.data.roomType, parsed.data.roomName, parsed.data.expiresInMinutes);
    res.status(201).json(successResponse(room));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ROOM_LIMIT_REACHED:')) {
      const roomType = error.message.split(':')[1];
      res.status(429).json(errorResponse('ROOM_LIMIT_REACHED', `You can create up to 3 active ${roomType} rooms.`));
      return;
    }
    throw error;
  }
};

export const getRoomController = async (req: Request, res: Response) => {
  const code = String(req.params.code ?? '').toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  res.json(successResponse(room));
};

export const getMessagesController = async (req: Request, res: Response) => {
  const code = String(req.params.code ?? '').toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  const messages = await listMessages(room.id);
  res.json(successResponse(messages));
};

export const deleteMessageController = async (req: Request, res: Response) => {
  const parsed = deleteMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId is required.'));
    return;
  }
  const code = String(req.params.code ?? '').toUpperCase();
  const messageId = String(req.params.messageId ?? '');
  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  const message = await getMessageById(messageId);
  if (!message || message.room_id !== room.id) {
    res.status(404).json(errorResponse('MESSAGE_NOT_FOUND', 'Message not found.'));
    return;
  }
  if (message.deleted) {
    res.status(409).json(errorResponse('MESSAGE_ALREADY_DELETED', 'Message is already deleted.'));
    return;
  }
  if (message.sender_id !== parsed.data.senderId) {
    res.status(403).json(errorResponse('FORBIDDEN', 'You can delete only your own messages.'));
    return;
  }
  const deletedByName = message.sender_name ?? `User-${message.sender_id.slice(0, 6)}`;
  if (message.file_path) {
    try {
      await deleteMediaByFileId(message.file_path);
    } catch {
      // Media deletion is best-effort; the tombstone should still be persisted.
    }
  }
  await deleteMessageById(message.id, message.sender_id, deletedByName);
  emitMessageDeleted(room.id, { messageId: message.id, deletedBy: message.sender_id, deletedByName });
  res.json(successResponse({ deleted: true, messageId: message.id, deletedBy: message.sender_id, deletedByName }));
};

export const editMessageController = async (req: Request, res: Response) => {
  const parsed = editMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId and content are required.'));
    return;
  }
  const code = String(req.params.code ?? '').toUpperCase();
  const messageId = String(req.params.messageId ?? '');
  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  const message = await getMessageById(messageId);
  if (!message || message.room_id !== room.id) {
    res.status(404).json(errorResponse('MESSAGE_NOT_FOUND', 'Message not found.'));
    return;
  }
  if (message.deleted) {
    res.status(409).json(errorResponse('MESSAGE_DELETED', 'Deleted messages cannot be edited.'));
    return;
  }
  if (message.sender_id !== parsed.data.senderId) {
    res.status(403).json(errorResponse('FORBIDDEN', 'You can edit only your own messages.'));
    return;
  }
  if (message.type !== 'text') {
    res.status(400).json(errorResponse('TEXT_ONLY', 'Only text messages can be edited.'));
    return;
  }
  const createdAt = new Date(message.created_at).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > 2 * 60 * 1000) {
    res.status(403).json(errorResponse('EDIT_WINDOW_CLOSED', 'Messages can be edited for 2 minutes.'));
    return;
  }
  const updated = await updateMessageContent(message.id, parsed.data.content);
  emitMessageEdited(room.id, { messageId: message.id, content: parsed.data.content, editedBy: parsed.data.senderId });
  res.json(successResponse({ ...updated, edited: true }));
};

export const reactToMessageController = async (req: Request, res: Response) => {
  const parsed = reactionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId, senderName and emoji are required.'));
    return;
  }
  const code = String(req.params.code ?? '').toUpperCase();
  const messageId = String(req.params.messageId ?? '');
  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  const message = await getMessageById(messageId);
  if (!message || message.room_id !== room.id) {
    res.status(404).json(errorResponse('MESSAGE_NOT_FOUND', 'Message not found.'));
    return;
  }
  const reactions = await toggleMessageReaction(message.id, parsed.data.senderId, parsed.data.senderName, parsed.data.emoji);
  emitMessageReactions(room.id, { messageId: message.id, reactions });
  res.json(successResponse({ messageId: message.id, reactions }));
};

export const pinMessageController = async (req: Request, res: Response) => {
  const parsed = pinMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId is required.'));
    return;
  }
  const code = String(req.params.code ?? '').toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  const messageId = parsed.data.messageId ?? null;
  if (messageId) {
    const message = await getMessageById(messageId);
    if (!message || message.room_id !== room.id) {
      res.status(404).json(errorResponse('MESSAGE_NOT_FOUND', 'Message not found.'));
      return;
    }
  }
  const result = await pinRoomMessage(code, parsed.data.senderId, messageId);
  if ('error' in result) {
    if (result.error === 'FORBIDDEN') {
      res.status(403).json(errorResponse('FORBIDDEN', 'Only room creator can pin messages.'));
      return;
    }
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  emitMessagePinned(result.room.id, { code: result.room.code, pinnedMessageId: result.pinnedMessageId });
  res.json(successResponse(result.room));
};

export const terminateRoomController = async (req: Request, res: Response) => {
  const parsed = terminateRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId is required.'));
    return;
  }
  const code = String(req.params.code ?? '').toUpperCase();
  const result = await terminateRoom(code, parsed.data.senderId);
  if ('error' in result) {
    if (result.error === 'FORBIDDEN') {
      res.status(403).json(errorResponse('FORBIDDEN', 'Only room creator can terminate this channel.'));
      return;
    }
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  emitRoomExpired(result.roomId, { reason: 'terminated-by-creator' });
  emitRoomExpiredByCode(result.code, { reason: 'terminated-by-creator' });
  res.json(successResponse(result));
};

export const extendRoomController = async (req: Request, res: Response) => {
  const parsed = extendRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId and extendByMinutes are required.'));
    return;
  }
  const code = String(req.params.code ?? '').toUpperCase();
  const result = await extendRoomExpiry(code, parsed.data.senderId, parsed.data.extendByMinutes);
  if ('error' in result) {
    if (result.error === 'FORBIDDEN') {
      res.status(403).json(errorResponse('FORBIDDEN', 'Only room creator can extend this channel.'));
      return;
    }
    if (result.error === 'EXTENSION_USED') {
      res.status(409).json(errorResponse('EXTENSION_USED', 'This channel has already been extended.'));
      return;
    }
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  emitRoomExtended(result.room.id, {
    code: result.room.code,
    expiresAt: result.room.expires_at,
    extendByMinutes: result.extendByMinutes
  });
  res.json(successResponse(result.room));
};

export const getMyRoomsController = async (req: Request, res: Response) => {
  const parsed = senderParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid sender id.'));
    return;
  }
  const rooms = await getActiveRoomsForSender(parsed.data.senderId);
  res.json(successResponse(rooms));
};

export const leaveRoomController = async (req: Request, res: Response) => {
  const code = String(req.params.code ?? '').toUpperCase();
  const parsed = terminateRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId is required.'));
    return;
  }
  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  await leaveMembership(room.id, parsed.data.senderId);
  res.json(successResponse({ left: true }));
};

export const participantsController = async (req: Request, res: Response) => {
  const code = String(req.params.code ?? '').toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }
  const participants = await getParticipantsForRoom(room.id);
  res.json(successResponse(participants));
};
