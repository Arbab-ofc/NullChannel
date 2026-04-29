import type { Request, Response } from 'express';
import { createRoom, getRoomByCode } from '../services/room.service.js';
import { listMessages } from '../services/message.service.js';
import { successResponse, errorResponse } from '../utils/apiResponse.js';

export const createRoomController = async (_req: Request, res: Response) => {
  const room = await createRoom();
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
