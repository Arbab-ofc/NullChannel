import type { Request, Response } from 'express';
import { mediaBodySchema } from '../schemas/media.schema.js';
import { uploadMedia } from '../services/media.service.js';
import { getRoomByCode } from '../services/room.service.js';
import { isActiveMember } from '../services/membership.service.js';
import { LIMITS } from '../constants/limits.js';
import { errorResponse, successResponse } from '../utils/apiResponse.js';

const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'];
const voiceTypes = ['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'application/octet-stream'];
const fileTypes = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream'
];

export const uploadMediaController = async (req: Request, res: Response) => {
  const parsed = mediaBodySchema.safeParse(req.body);
  if (!parsed.success || !req.file) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid upload request.'));
    return;
  }

  const room = await getRoomByCode(parsed.data.roomCode);
  if (!room) {
    res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.'));
    return;
  }

  const activeMember = await isActiveMember(room.id, parsed.data.senderId);
  if (!activeMember) {
    res.status(403).json(errorResponse('JOIN_REQUIRED', 'Join this channel before sending media.'));
    return;
  }

  const allowed = parsed.data.type === 'image' ? imageTypes : parsed.data.type === 'voice' ? voiceTypes : fileTypes;
  const max = parsed.data.type === 'image' ? LIMITS.IMAGE_MAX_BYTES : parsed.data.type === 'voice' ? LIMITS.VOICE_MAX_BYTES : LIMITS.FILE_MAX_BYTES;

  if (!allowed.includes(req.file.mimetype) || req.file.size > max) {
    res.status(400).json(errorResponse('INVALID_MEDIA', 'Invalid media format or size.'));
    return;
  }

  const uploaded = await uploadMedia(req.file, `/nullchannel/${room.code.toLowerCase()}`);
  res.json(successResponse(uploaded));
};
