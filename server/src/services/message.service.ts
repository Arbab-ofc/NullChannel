import { supabase } from '../config/supabase.js';
import type { MessagePayload } from '../types/index.js';

export const listMessages = async (roomId: string) => {
  let { data, error } = await supabase
    .from('messages')
    .select('id, room_id, sender_id, sender_name, type, content, file_url, file_path, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error?.message?.includes('sender_name')) {
    const fallback = await supabase
      .from('messages')
      .select('id, room_id, sender_id, type, content, file_url, file_path, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    data = (fallback.data ?? []).map((m) => ({ ...m, sender_name: 'Member' }));
    error = fallback.error;
  }
  if (error) throw error;
  return data ?? [];
};

export const saveMessage = async (roomId: string, payload: MessagePayload) => {
  let { data, error } = await supabase
    .from('messages')
    .insert({
      room_id: roomId,
      sender_id: payload.senderId,
      sender_name: payload.senderName,
      type: payload.type,
      content: payload.content ?? null,
      file_url: payload.fileUrl ?? null,
      file_path: payload.filePath ?? null
    })
    .select('id, room_id, sender_id, sender_name, type, content, file_url, file_path, created_at')
    .single();
  if (error?.message?.includes('sender_name')) {
    const fallback = await supabase
      .from('messages')
      .insert({
        room_id: roomId,
        sender_id: payload.senderId,
        type: payload.type,
        content: payload.content ?? null,
        file_url: payload.fileUrl ?? null,
        file_path: payload.filePath ?? null
      })
      .select('id, room_id, sender_id, type, content, file_url, file_path, created_at')
      .single();
    data = fallback.data ? { ...fallback.data, sender_name: payload.senderName } : null;
    error = fallback.error;
  }

  if (error) throw error;
  return data;
};
