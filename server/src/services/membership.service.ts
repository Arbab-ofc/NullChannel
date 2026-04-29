import { supabase } from '../config/supabase.js';

export const joinMembership = async (roomId: string, senderId: string, senderName: string) => {
  let { error } = await supabase.from('room_members').upsert(
    { room_id: roomId, sender_id: senderId, sender_name: senderName, left_at: null },
    { onConflict: 'room_id,sender_id' }
  );
  if (error?.message?.includes('sender_name')) {
    const fallback = await supabase.from('room_members').upsert(
      { room_id: roomId, sender_id: senderId, left_at: null },
      { onConflict: 'room_id,sender_id' }
    );
    error = fallback.error;
  }
  if (error) throw error;
};

export const leaveMembership = async (roomId: string, senderId: string) => {
  const { error } = await supabase.from('room_members').update({ left_at: new Date().toISOString() }).eq('room_id', roomId).eq('sender_id', senderId);
  if (error) throw error;
};

export const getActiveRoomsForSender = async (senderId: string) => {
  const nowIso = new Date().toISOString();
  const { data: memberships, error: membershipsError } = await supabase
    .from('room_members')
    .select('room_id, joined_at')
    .eq('sender_id', senderId)
    .is('left_at', null);
  if (membershipsError) throw membershipsError;

  const joinedRoomIds = (memberships ?? []).map((m) => m.room_id);
  let joinedRooms: Array<Record<string, unknown>> = [];
  if (joinedRoomIds.length > 0) {
    const { data: joinedRoomsData, error: joinedRoomsError } = await supabase
      .from('rooms')
      .select('id, code, room_name, room_type, expires_at, creator_id, created_at')
      .in('id', joinedRoomIds)
      .gt('expires_at', nowIso);
    if (joinedRoomsError) throw joinedRoomsError;

    const joinedAtMap = new Map((memberships ?? []).map((m) => [m.room_id, m.joined_at]));
    joinedRooms = (joinedRoomsData ?? []).map((room) => ({
      ...room,
      room_type: room.room_type ?? 'private',
      room_name: room.room_name ?? 'Untitled Room',
      joined_at: joinedAtMap.get(room.id) ?? room.created_at
    }));
  }

  const { data: created, error: createdError } = await supabase
    .from('rooms')
    .select('id, code, room_name, room_type, expires_at, creator_id, created_at')
    .eq('creator_id', senderId)
    .gt('expires_at', nowIso);
  if (createdError) throw createdError;

  const byCode = new Map<string, Record<string, unknown>>();
  for (const room of joinedRooms) {
    if (typeof room.code === 'string') byCode.set(room.code, room);
  }
  for (const room of created ?? []) {
    byCode.set(room.code, {
      ...room,
      room_type: room.room_type ?? 'private',
      room_name: room.room_name ?? 'Untitled Room',
      joined_at: room.created_at
    });
  }

  return Array.from(byCode.values());
};

export const getParticipantsForRoom = async (roomId: string) => {
  const { data, error } = await supabase
    .from('room_members')
    .select('sender_id, sender_name, joined_at')
    .eq('room_id', roomId)
    .is('left_at', null)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const countActiveMembers = async (roomId: string) => {
  const { count, error } = await supabase
    .from('room_members')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .is('left_at', null);
  if (error) throw error;
  return count ?? 0;
};

export const isActiveMember = async (roomId: string, senderId: string) => {
  const { data, error } = await supabase
    .from('room_members')
    .select('id')
    .eq('room_id', roomId)
    .eq('sender_id', senderId)
    .is('left_at', null)
    .maybeSingle();
  if (error) throw error;
  return !!data;
};
