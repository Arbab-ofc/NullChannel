import { supabase } from '../config/supabase.js';
import { emitRoomExpired, emitRoomExpiredByCode } from '../sockets/emitter.js';
import { deleteMediaByFileId } from './media.service.js';

export const cleanupRoomsByIds = async (roomIds: string[]) => {
  if (!roomIds.length) return { removedRooms: 0 };

  const { data: mediaRows } = await supabase
    .from('messages')
    .select('file_path')
    .in('room_id', roomIds)
    .not('file_path', 'is', null);

  for (const row of mediaRows ?? []) {
    if (row.file_path) {
      try {
        await deleteMediaByFileId(row.file_path);
      } catch {
        // best effort
      }
    }
  }

  await supabase.from('rooms').delete().in('id', roomIds);
  return { removedRooms: roomIds.length };
};

export const cleanupExpiredRooms = async () => {
  const now = new Date().toISOString();
  const { data: rooms, error } = await supabase.from('rooms').select('id, code').lte('expires_at', now);
  if (error || !rooms?.length) return { removedRooms: 0 };

  const roomIds = rooms.map((r) => r.id);
  for (const room of rooms) {
    emitRoomExpired(room.id, { reason: 'expired' });
    emitRoomExpiredByCode(room.code, { reason: 'expired' });
  }
  return cleanupRoomsByIds(roomIds);
};
