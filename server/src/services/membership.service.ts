import { supabase } from '../config/supabase.js';

export const joinMembership = async (roomId: string, senderId: string, senderName: string) => {
  const { error } = await supabase.from('room_members').upsert(
    { room_id: roomId, sender_id: senderId, sender_name: senderName, left_at: null },
    { onConflict: 'room_id,sender_id' }
  );
  if (error) throw error;
};

export const leaveMembership = async (roomId: string, senderId: string) => {
  const { error } = await supabase.from('room_members').update({ left_at: new Date().toISOString() }).eq('room_id', roomId).eq('sender_id', senderId);
  if (error) throw error;
};

export const getActiveRoomsForSender = async (senderId: string) => {
  const { data, error } = await supabase
    .from('room_members')
    .select('room_id, joined_at, rooms!inner(id, code, expires_at, creator_id)')
    .eq('sender_id', senderId)
    .is('left_at', null)
    .gt('rooms.expires_at', new Date().toISOString());
  if (error) throw error;
  return (data ?? []).map((row) => {
    const room = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
    return { ...(room ?? {}), joined_at: row.joined_at };
  });
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
