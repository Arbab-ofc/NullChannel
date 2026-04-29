import { supabase } from '../config/supabase.js';
import { generateCode } from '../utils/generateCode.js';
import { cleanupRoomsByIds } from './cleanup.service.js';

const roomSelectWithType = 'id, code, creator_id, room_type, created_at, expires_at';

export const createRoom = async (creatorId: string, roomType: 'private' | 'group') => {
  let lastErrorMessage = 'Failed to create room';
  for (let i = 0; i < 5; i += 1) {
    const code = generateCode();
    const { data, error } = await supabase.from('rooms').insert({ code, creator_id: creatorId, room_type: roomType }).select(roomSelectWithType).single();
    if (!error && data) return data;
    if (error?.message) lastErrorMessage = error.message;
  }
  if (lastErrorMessage.includes('creator_id')) {
    throw new Error('Database schema is outdated. Run docs/supabase-migration-v2.sql and retry.');
  }
  if (lastErrorMessage.includes('room_type')) {
    throw new Error('Database schema is outdated. Run docs/supabase-migration-v4.sql and retry.');
  }
  throw new Error(lastErrorMessage);
};

export const getRoomByCode = async (code: string) => {
  const { data } = await supabase
    .from('rooms')
    .select(roomSelectWithType)
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  return data;
};

export const terminateRoom = async (code: string, senderId: string) => {
  const room = await getRoomByCode(code);
  if (!room) return { error: 'ROOM_NOT_FOUND' as const };
  if (room.creator_id !== senderId) return { error: 'FORBIDDEN' as const };
  await cleanupRoomsByIds([room.id]);
  return { roomId: room.id, code: room.code, terminated: true as const };
};
