import { supabase } from '../config/supabase.js';
import { emitRoomExpired, emitRoomExpiredByCode } from '../sockets/emitter.js';
import { deleteMediaByFileId, recoverUploadIntents } from './media.service.js';
import { logger } from '../utils/logger.js';

export const cleanupRoomsByIds = async (roomIds: string[]) => {
  if (!roomIds.length) return { removedRooms: 0 };
  // Database triggers durably queue media before cascade deletion.
  const { error, count } = await supabase.from('rooms').delete({ count: 'exact' }).in('id', roomIds);
  if (error) throw error;
  return { removedRooms: count ?? 0 };
};
export const processMediaCleanup = async () => {
  const { data, error } = await supabase.rpc('claim_media_cleanup');
  if (error) throw error;
  for (const item of data ?? []) {
    try {
      try { await deleteMediaByFileId(item.file_id); }
      catch (failure) { if ((failure as { statusCode?: number }).statusCode !== 404) throw failure; }
      const deletedUpload = await supabase.from('media_uploads').delete().eq('file_id', item.file_id);
      if (deletedUpload.error) throw deletedUpload.error;
      const deletedJob = await supabase.from('media_cleanup').delete().eq('file_id', item.file_id);
      if (deletedJob.error) throw deletedJob.error;
    } catch {
      const attempts = item.attempts + 1;
      const { error: retryError } = await supabase.from('media_cleanup').update({ attempts, lease_until: null, next_attempt_at: new Date(Date.now() + Math.min(3600000, 10000 * 2 ** Math.min(attempts, 10))).toISOString() }).eq('file_id', item.file_id);
      logger.error('media_cleanup_failed', { attempts, retryRecorded: !retryError });
    }
  }
};
let running = false;
export const cleanupExpiredRooms = async () => {
  if (running) return { removedRooms: 0 };
  running = true;
  try {
    const { data: rooms, error } = await supabase.rpc('cleanup_expired_rooms');
    if (error) throw error;
    for (const room of rooms ?? []) {
      emitRoomExpiredByCode(room.code, { reason: 'expired' });
      emitRoomExpired(room.id, { reason: 'expired' });
    }
    await recoverUploadIntents();
    await processMediaCleanup();
    const removedRooms = rooms?.length ?? 0;
    logger.info('cleanup_complete', { removedRooms });
    return { removedRooms };
  } finally { running = false; }
};
