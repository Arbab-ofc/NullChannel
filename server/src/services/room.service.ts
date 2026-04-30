import { supabase } from '../config/supabase.js';
import { generateCode } from '../utils/generateCode.js';
import { cleanupRoomsByIds } from './cleanup.service.js';
import { joinMembership } from './membership.service.js';

const roomSelectWithType = 'id, code, creator_id, room_type, room_name, created_at, expires_at';

export const createRoom = async (creatorId: string, roomType: 'private' | 'group', roomName: string) => {
  const { count, error: countError } = await supabase
    .from('rooms')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .eq('room_type', roomType)
    .gt('expires_at', new Date().toISOString());
  if (countError) throw countError;
  if ((count ?? 0) >= 3) {
    throw new Error(`ROOM_LIMIT_REACHED:${roomType}`);
  }

  let lastErrorMessage = 'Failed to create room';
  for (let i = 0; i < 5; i += 1) {
    const code = generateCode();
    const { data, error } = await supabase.from('rooms').insert({ code, creator_id: creatorId, room_type: roomType, room_name: roomName }).select(roomSelectWithType).single();
    if (!error && data) {
      await joinMembership(data.id, creatorId, `User-${creatorId.slice(0, 6)}`);
      return data;
    }
    if (error?.message) lastErrorMessage = error.message;
  }
  if (lastErrorMessage.includes('creator_id')) {
    throw new Error('Database schema is outdated. Run docs/supabase-migration-v2.sql and retry.');
  }
  if (lastErrorMessage.includes('room_type')) {
    throw new Error('Database schema is outdated. Run docs/supabase-migration-v4.sql and retry.');
  }
  if (lastErrorMessage.includes('room_name')) {
    throw new Error('Database schema is outdated. Run docs/supabase-migration-v5.sql and retry.');
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
