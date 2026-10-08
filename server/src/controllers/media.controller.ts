import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';
import { supabase } from '../config/supabase.js';
import { normalizeMediaType, validSignature } from '../services/media-validation.js';
import { mediaBodySchema } from '../schemas/media.schema.js';
import { deleteMediaByFileId, uploadMedia } from '../services/media.service.js';
import { getRoomByCode } from '../services/room.service.js';
import { isActiveMember } from '../services/membership.service.js';
import { LIMITS } from '../constants/limits.js';
import { errorResponse, successResponse } from '../utils/apiResponse.js';

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const voiceTypes = ['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav'];
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
];

export const uploadMediaController = async (req: Request, res: Response) => {
  req.body.senderId = res.locals.identity;
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

  req.file.mimetype = normalizeMediaType(req.file.mimetype, req.file.originalname);
  const allowed = parsed.data.type === 'image' ? imageTypes : parsed.data.type === 'voice' ? voiceTypes : fileTypes;
  const max = parsed.data.type === 'image' ? LIMITS.IMAGE_MAX_BYTES : parsed.data.type === 'voice' ? LIMITS.VOICE_MAX_BYTES : LIMITS.FILE_MAX_BYTES;

  if (!allowed.includes(req.file.mimetype) || req.file.size > max || !validSignature(req.file.buffer, req.file.mimetype)) {
    res.status(400).json(errorResponse('INVALID_MEDIA', 'Invalid media format or size.'));
    return;
  }

  const uploaded = await uploadMedia(req.file, `/nullchannel/${room.code.toLowerCase()}`, room.id, res.locals.identity);
  const { error } = await supabase.from('media_uploads').insert({ file_id: uploaded.fileId, room_id: room.id, sender_id: res.locals.identity, file_url: uploaded.fileUrl, file_path: uploaded.filePath, file_name: req.file.originalname.slice(0, 240), file_size: req.file.size, mime_type: req.file.mimetype, media_type: parsed.data.type });
  if (error) {
    try { await deleteMediaByFileId(uploaded.fileId); } catch { throw new Error('Upload registry failed and remote rollback failed'); }
    throw error;
  }
  const removedIntent = await supabase.from('media_upload_intents').delete().eq('id', uploaded.intentId);
  if (removedIntent.error) logger.error('upload_intent_finalize_failed');
  if (req.aborted || res.destroyed) {
    const { error: queueError } = await supabase.from('media_cleanup').upsert({ file_id: uploaded.fileId });
    if (queueError) throw queueError;
    return;
  }
  res.json(successResponse({ fileUrl: uploaded.fileUrl, filePath: uploaded.filePath, fileId: uploaded.fileId }));
};
