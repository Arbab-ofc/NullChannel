import { supabase } from '../config/supabase.js';
import { generateCode } from '../utils/generateCode.js';

const roomSelect = 'id, code, creator_id, created_at, expires_at';

export const createRoom = async (creatorId: string) => {
  for (let i = 0; i < 5; i += 1) {
    const code = generateCode();
    const { data, error } = await supabase.from('rooms').insert({ code, creator_id: creatorId }).select(roomSelect).single();
    if (!error && data) return data;
  }
  throw new Error('Failed to create room');
};

export const getRoomByCode = async (code: string) => {
  const { data } = await supabase
    .from('rooms')
    .select(roomSelect)
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  return data;
};

export const terminateRoom = async (code: string, senderId: string) => {
  const room = await getRoomByCode(code);
  if (!room) return { error: 'ROOM_NOT_FOUND' as const };
  if (room.creator_id !== senderId) return { error: 'FORBIDDEN' as const };

  const { data, error } = await supabase
    .from('rooms')
    .update({ expires_at: new Date().toISOString() })
    .eq('id', room.id)
    .select(roomSelect)
    .single();

  if (error) throw error;
  return { room: data };
};
