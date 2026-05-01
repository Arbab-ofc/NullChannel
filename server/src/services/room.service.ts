import { supabase } from '../config/supabase.js';
import { generateCode } from '../utils/generateCode.js';
import { cleanupRoomsByIds } from './cleanup.service.js';
import { joinMembership } from './membership.service.js';

const roomSelectWithType = 'id, code, creator_id, room_type, room_name, created_at, expires_at, expiry_extended, pinned_message_id';
const legacyRoomSelectWithType = 'id, code, creator_id, room_type, room_name, created_at, expires_at, expiry_extended';

const withPinnedFallback = <T extends { pinned_message_id?: string | null } | null>(data: T) => data;

export const createRoom = async (creatorId: string, creatorName: string, roomType: 'private' | 'group', roomName: string, expiresInMinutes: number) => {
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
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    let { data, error } = await supabase
      .from('rooms')
      .insert({ code, creator_id: creatorId, room_type: roomType, room_name: roomName, expires_at: expiresAt })
      .select(roomSelectWithType)
      .single();
    if (error?.message?.includes('pinned_message_id')) {
      const fallback = await supabase
        .from('rooms')
        .insert({ code, creator_id: creatorId, room_type: roomType, room_name: roomName, expires_at: expiresAt })
        .select(legacyRoomSelectWithType)
        .single();
      data = fallback.data ? { ...fallback.data, pinned_message_id: null } : null;
      error = fallback.error;
    }
    if (!error && data) {
      await joinMembership(data.id, creatorId, creatorName);
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
  if (lastErrorMessage.includes('expiry_extended')) {
    throw new Error('Database schema is outdated. Run docs/supabase-migration-v6.sql and retry.');
  }
  throw new Error(lastErrorMessage);
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
  }
  return withPinnedFallback(data);
};

export const extendRoomExpiry = async (code: string, senderId: string, extendByMinutes: number) => {
  const room = await getRoomByCode(code);
  if (!room) return { error: 'ROOM_NOT_FOUND' as const };
  if (room.creator_id !== senderId) return { error: 'FORBIDDEN' as const };
  if (room.expiry_extended) return { error: 'EXTENSION_USED' as const };

  const currentExpiryMs = new Date(room.expires_at).getTime();
  const baseMs = Number.isFinite(currentExpiryMs) ? Math.max(currentExpiryMs, Date.now()) : Date.now();
  const expiresAt = new Date(baseMs + extendByMinutes * 60 * 1000).toISOString();
  let { data, error } = await supabase
    .from('rooms')
    .update({ expires_at: expiresAt, expiry_extended: true })
    .eq('id', room.id)
    .eq('expiry_extended', false)
    .select(roomSelectWithType)
    .maybeSingle();
  if (error?.message?.includes('pinned_message_id')) {
    const fallback = await supabase
      .from('rooms')
      .update({ expires_at: expiresAt, expiry_extended: true })
      .eq('id', room.id)
      .eq('expiry_extended', false)
      .select(legacyRoomSelectWithType)
      .maybeSingle();
    data = fallback.data ? { ...fallback.data, pinned_message_id: null } : null;
    error = fallback.error;
  }
  if (error?.message?.includes('expiry_extended')) {
    throw new Error('Database schema is outdated. Run docs/supabase-migration-v6.sql and retry.');
  }
  if (error) throw error;
  if (!data) return { error: 'EXTENSION_USED' as const };
  return { room: data, extendByMinutes };
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
