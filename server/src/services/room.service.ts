import { supabase } from '../config/supabase.js';
import { generateCode } from '../utils/generateCode.js';
import { cleanupRoomsByIds } from './cleanup.service.js';

const roomSelectWithType = 'id, code, creator_id, room_type, room_name, created_at, expires_at, expiry_extended, pinned_message_id';
const legacyRoomSelectWithType = 'id, code, creator_id, room_type, room_name, created_at, expires_at, expiry_extended';

const withPinnedFallback = <T extends { pinned_message_id?: string | null } | null>(data: T) => data;

export const createRoom = async (creatorId: string, creatorName: string, roomType: 'private' | 'group', roomName: string, expiresInMinutes: number) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase.rpc('create_room', { p_code: generateCode(), p_sender: creatorId, p_name: creatorName, p_type: roomType, p_room_name: roomName, p_minutes: expiresInMinutes });
    if (!error && data?.[0]) return data[0];
    if (error?.message?.includes('ROOM_LIMIT_REACHED')) throw new Error(`ROOM_LIMIT_REACHED:${roomType}`);
    if (error?.code !== '23505') throw error ?? new Error('Room creation failed');
  }
  throw new Error('Room code allocation failed');
};

export const getRoomByCode = async (code: string) => {
  let { data, error } = await supabase
    .from('rooms')
    .select(roomSelectWithType)
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error?.message?.includes('pinned_message_id')) {
    const fallback = await supabase
      .from('rooms')
      .select(legacyRoomSelectWithType)
      .eq('code', code)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    data = fallback.data ? { ...fallback.data, pinned_message_id: null } : null;
    error = fallback.error;
  }
  if (error) throw error;
  return withPinnedFallback(data);
};

export const extendRoomExpiry = async (code: string, senderId: string, extendByMinutes: number) => {
  const { data, error } = await supabase.rpc('extend_room', { p_code: code, p_sender: senderId, p_minutes: extendByMinutes });
  if (error) {
    if (error.message.includes('ROOM_NOT_FOUND')) return { error: 'ROOM_NOT_FOUND' as const };
    if (error.message.includes('FORBIDDEN')) return { error: 'FORBIDDEN' as const };
    if (error.message.includes('EXTENSION_USED')) return { error: 'EXTENSION_USED' as const };
    throw error;
  }
  if (!data?.[0]) return { error: 'ROOM_NOT_FOUND' as const };
  return { room: data[0], extendByMinutes };
};

export const terminateRoom = async (code: string, senderId: string) => {
  const room = await getRoomByCode(code);
  if (!room) return { error: 'ROOM_NOT_FOUND' as const };
  if (room.creator_id !== senderId) return { error: 'FORBIDDEN' as const };
  await cleanupRoomsByIds([room.id]);
  return { roomId: room.id, code: room.code, terminated: true as const };
};

export const pinRoomMessage = async (code: string, senderId: string, messageId: string | null) => {
  const room = await getRoomByCode(code);
  if (!room) return { error: 'ROOM_NOT_FOUND' as const };
  if (room.creator_id !== senderId) return { error: 'FORBIDDEN' as const };

  const { data, error } = await supabase
    .from('rooms')
    .update({ pinned_message_id: messageId })
    .eq('id', room.id)
    .select(roomSelectWithType)
    .single();
  if (error?.message?.includes('pinned_message_id')) {
    throw new Error('Database schema is outdated. Run docs/supabase-migration-v8.sql and retry.');
  }
  if (error) throw error;
  return { room: data, pinnedMessageId: messageId };
};

export const wipeRoomMessages = async (code: string, senderId: string) => {
  const { data, error } = await supabase.rpc('wipe_room', { p_code: code, p_sender: senderId });
  if (error) {
    if (error.message.includes('FORBIDDEN')) return { error: 'FORBIDDEN' as const };
    if (error.message.includes('ROOM_NOT_FOUND')) return { error: 'ROOM_NOT_FOUND' as const };
    throw error;
  }
  const result = data?.[0];
  if (!result) return { error: 'ROOM_NOT_FOUND' as const };
  return { roomId: result.room_id, code: result.code, wipedMessages: Number(result.wiped_messages), wipedAt: result.wiped_at };
};
