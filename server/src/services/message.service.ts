import { supabase } from '../config/supabase.js';
import type { MessagePayload } from '../types/index.js';

type MessageRow = {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name?: string | null;
  type: string;
  content?: string | null;
  file_url?: string | null;
  file_path?: string | null;
  reply_to_message_id?: string | null;
  created_at: string;
};

type ReactionRow = {
  message_id: string;
  sender_id: string;
  sender_name: string;
  emoji: string;
};

const messageSelect = 'id, room_id, sender_id, sender_name, type, content, file_url, file_path, reply_to_message_id, created_at';
const legacyMessageSelect = 'id, room_id, sender_id, sender_name, type, content, file_url, file_path, created_at';

const summarizeReactions = (rows: ReactionRow[]) => {
  const grouped = new Map<string, { emoji: string; count: number; senders: Array<{ sender_id: string; sender_name: string }> }>();
  rows.forEach((row) => {
    const current = grouped.get(row.emoji) ?? { emoji: row.emoji, count: 0, senders: [] };
    current.count += 1;
    current.senders.push({ sender_id: row.sender_id, sender_name: row.sender_name });
    grouped.set(row.emoji, current);
  });
  return Array.from(grouped.values()).sort((a, b) => a.emoji.localeCompare(b.emoji));
};

const hydrateMessages = async (messages: MessageRow[]) => {
  if (messages.length === 0) return [];
  const ids = messages.map((message) => message.id);
  const replyIds = Array.from(new Set(messages.map((message) => message.reply_to_message_id).filter((id): id is string => !!id)));

  const [{ data: reactionRows, error: reactionError }, { data: replyRows, error: replyError }] = await Promise.all([
    supabase
      .from('message_reactions')
      .select('message_id, sender_id, sender_name, emoji')
      .in('message_id', ids),
    replyIds.length > 0
      ? supabase
        .from('messages')
        .select('id, sender_id, sender_name, type, content, file_url')
        .in('id', replyIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (reactionError) throw reactionError;
  if (replyError) throw replyError;

  const reactionsByMessage = new Map<string, ReactionRow[]>();
  (reactionRows ?? []).forEach((reaction) => {
    const list = reactionsByMessage.get(reaction.message_id) ?? [];
    list.push(reaction);
    reactionsByMessage.set(reaction.message_id, list);
  });

  const repliesById = new Map((replyRows ?? []).map((reply) => [reply.id, reply]));

  return messages.map((message) => ({
    ...message,
    reactions: summarizeReactions(reactionsByMessage.get(message.id) ?? []),
    reply_to: message.reply_to_message_id ? repliesById.get(message.reply_to_message_id) ?? null : null
  }));
};

const hydrateSingleMessage = async (message: MessageRow) => {
  try {
    const [hydrated] = await hydrateMessages([message]);
    return hydrated;
  } catch (hydrateError) {
    if (hydrateError instanceof Error && hydrateError.message.includes('message_reactions')) {
      return { ...message, reactions: [], reply_to: null };
    }
    throw hydrateError;
  }
};

export const listMessages = async (roomId: string) => {
  let { data, error } = await supabase
    .from('messages')
    .select(messageSelect)
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error?.message?.includes('reply_to_message_id')) {
    const fallback = await supabase
      .from('messages')
      .select(legacyMessageSelect)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    data = (fallback.data ?? []).map((m) => ({ ...m, reply_to_message_id: null }));
    error = fallback.error;
  }
  if (error?.message?.includes('sender_name')) {
    const fallback = await supabase
      .from('messages')
      .select('id, room_id, sender_id, type, content, file_url, file_path, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    data = (fallback.data ?? []).map((m) => ({ ...m, sender_name: 'Member', reply_to_message_id: null }));
    error = fallback.error;
  }
  if (error) throw error;
  try {
    return await hydrateMessages((data ?? []) as MessageRow[]);
  } catch (hydrateError) {
    if (hydrateError instanceof Error && hydrateError.message.includes('message_reactions')) {
      return (data ?? []).map((message) => ({ ...message, reactions: [], reply_to: null }));
    }
    throw hydrateError;
  }
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
      file_path: payload.filePath ?? null,
      reply_to_message_id: payload.replyToMessageId ?? null
    })
    .select(messageSelect)
    .single();
  if (error?.message?.includes('reply_to_message_id')) {
    const fallback = await supabase
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
      .select(legacyMessageSelect)
      .single();
    data = fallback.data ? { ...fallback.data, reply_to_message_id: null } : null;
    error = fallback.error;
  }
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
    data = fallback.data ? { ...fallback.data, sender_name: payload.senderName, reply_to_message_id: null } : null;
    error = fallback.error;
  }

  if (error) throw error;
  return hydrateSingleMessage(data as MessageRow);
};

export const getMessageById = async (messageId: string) => {
  let { data, error } = await supabase
    .from('messages')
    .select('id, room_id, sender_id, sender_name, type, file_path, created_at, reply_to_message_id')
    .eq('id', messageId)
    .maybeSingle();
  if (error?.message?.includes('reply_to_message_id')) {
    const fallback = await supabase
      .from('messages')
      .select('id, room_id, sender_id, sender_name, type, file_path, created_at')
      .eq('id', messageId)
      .maybeSingle();
    data = fallback.data ? { ...fallback.data, reply_to_message_id: null } : null;
    error = fallback.error;
  }
  if (error?.message?.includes('sender_name') || error?.message?.includes('file_path')) {
    const fallback = await supabase
      .from('messages')
      .select('id, room_id, sender_id, type, created_at')
      .eq('id', messageId)
      .maybeSingle();
    data = fallback.data ? { ...fallback.data, sender_name: `User-${fallback.data.sender_id.slice(0, 6)}`, file_path: null, reply_to_message_id: null } : null;
    error = fallback.error;
  }
  if (error) throw error;
  return data;
};

export const deleteMessageById = async (messageId: string) => {
  const { error } = await supabase.from('messages').delete().eq('id', messageId);
  if (error) throw error;
};

export const updateMessageContent = async (messageId: string, content: string) => {
  let { data, error } = await supabase
    .from('messages')
    .update({ content })
    .eq('id', messageId)
    .select(messageSelect)
    .single();
  if (error?.message?.includes('reply_to_message_id')) {
    const fallback = await supabase
      .from('messages')
      .update({ content })
      .eq('id', messageId)
      .select(legacyMessageSelect)
      .single();
    data = fallback.data ? { ...fallback.data, reply_to_message_id: null } : null;
    error = fallback.error;
  }
  if (error?.message?.includes('sender_name')) {
    const fallback = await supabase
      .from('messages')
      .update({ content })
      .eq('id', messageId)
      .select('id, room_id, sender_id, type, content, file_url, file_path, created_at')
      .single();
    data = fallback.data ? { ...fallback.data, sender_name: `User-${fallback.data.sender_id.slice(0, 6)}`, reply_to_message_id: null } : null;
    error = fallback.error;
  }
  if (error) throw error;
  return hydrateSingleMessage(data as MessageRow);
};

export const toggleMessageReaction = async (messageId: string, senderId: string, senderName: string, emoji: string) => {
  const { data: existing, error: lookupError } = await supabase
    .from('message_reactions')
    .select('id')
    .eq('message_id', messageId)
    .eq('sender_id', senderId)
    .eq('emoji', emoji)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('message_reactions').insert({
      message_id: messageId,
      sender_id: senderId,
      sender_name: senderName,
      emoji
    });
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from('message_reactions')
    .select('message_id, sender_id, sender_name, emoji')
    .eq('message_id', messageId);
  if (error) throw error;

  return summarizeReactions((data ?? []) as ReactionRow[]);
};
