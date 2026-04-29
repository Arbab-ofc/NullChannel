import type { Request, Response } from 'express';
import { createRoom, getRoomByCode, terminateRoom } from '../services/room.service.js';
import { listMessages } from '../services/message.service.js';
import { successResponse, errorResponse } from '../utils/apiResponse.js';
import { createRoomSchema, senderParamSchema, terminateRoomSchema } from '../schemas/room.schema.js';
import { getActiveRoomsForSender, getParticipantsForRoom, leaveMembership } from '../services/membership.service.js';
import { emitRoomExpired } from '../sockets/emitter.js';

export const createRoomController = async (req: Request, res: Response) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'senderId is required.'));
    return;
  }
  const room = await createRoom(parsed.data.senderId);
  res.status(201).json(successResponse(room));
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
  emitRoomExpired(result.room.id, { reason: 'terminated-by-creator' });
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
