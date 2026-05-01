import { z } from 'zod';

const senderId = z.string().uuid();

export const deleteMessageSchema = z.object({
  senderId
});

export const editMessageSchema = z.object({
  senderId,
  content: z.string().trim().min(1).max(12000)
});

export const reactionSchema = z.object({
  senderId,
  senderName: z.string().trim().min(2).max(24),
  emoji: z.string().trim().min(1).max(8)
});

export const socketMessageSchema = z.object({
  roomCode: z.string().trim().length(8).regex(/^[A-Z0-9]+$/),
  senderId,
  senderName: z.string().trim().min(2).max(24).optional(),
  type: z.enum(['text', 'image', 'voice']),
  content: z.string().trim().max(12000).optional(),
  fileUrl: z.string().url().optional(),
  filePath: z.string().optional(),
  replyToMessageId: z.string().uuid().optional()
}).refine((v) => (v.type === 'text' ? !!v.content : !!v.fileUrl), 'Invalid message payload');
