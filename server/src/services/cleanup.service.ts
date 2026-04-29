import { supabase } from '../config/supabase.js';
import { deleteMediaByFileId } from './media.service.js';

export const cleanupExpiredRooms = async () => {
  const now = new Date().toISOString();
  const { data: rooms, error } = await supabase.from('rooms').select('id').lte('expires_at', now);
  if (error || !rooms?.length) return { removedRooms: 0 };

  const roomIds = rooms.map((r) => r.id);
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
