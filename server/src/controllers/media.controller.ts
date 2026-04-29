import type { Request, Response } from 'express';
import { mediaBodySchema } from '../schemas/media.schema.js';
import { uploadMedia } from '../services/media.service.js';
import { getRoomByCode } from '../services/room.service.js';
import { LIMITS } from '../constants/limits.js';
import { errorResponse, successResponse } from '../utils/apiResponse.js';

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const voiceTypes = ['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav'];

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

  const isImage = parsed.data.type === 'image';
  const allowed = isImage ? imageTypes : voiceTypes;
  const max = isImage ? LIMITS.IMAGE_MAX_BYTES : LIMITS.VOICE_MAX_BYTES;

  if (!allowed.includes(req.file.mimetype) || req.file.size > max) {
    res.status(400).json(errorResponse('INVALID_MEDIA', 'Invalid media format or size.'));
    return;
  }

  const uploaded = await uploadMedia(req.file, `/nullchannel/${room.code.toLowerCase()}`);
  res.json(successResponse(uploaded));
};
