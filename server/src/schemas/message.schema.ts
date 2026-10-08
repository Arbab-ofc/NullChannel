import { z } from 'zod';

const senderId = z.string().uuid();

export const deleteMessageSchema = z.strictObject({
  senderId
});

export const editMessageSchema = z.strictObject({
  senderId,
  content: z.string().trim().min(1).max(12000)
});

export const reactionSchema = z.strictObject({
  senderId,
  senderName: z.string().trim().min(2).max(24),
  emoji: z.enum(['👍', '😂', '🔥', '❤️', '👀'])
});

export const burnReadSchema = z.strictObject({
  senderId,
  viewProtocol: z.literal('focused-viewport-v1')
});

export const socketMessageSchema = z.strictObject({
  roomCode: z.string().trim().length(8).regex(/^[A-Z0-9]+$/),
  senderId,
  senderName: z.string().trim().min(2).max(24).optional(),
  type: z.enum(['text', 'image', 'voice', 'file']),
  content: z.string().trim().max(12000).optional(),
  fileUrl: z.string().url().optional(),
  filePath: z.string().max(512).optional(),
  fileName: z.string().trim().min(1).max(240).optional(),
  fileSize: z.number().int().min(0).max(15 * 1024 * 1024).optional(),
  mimeType: z.string().trim().max(160).optional(),
  replyToMessageId: z.string().uuid().optional(),
  burnAfterRead: z.boolean().optional()
}).refine((v) => (v.type === 'text' ? !!v.content : !!v.fileUrl), 'Invalid message payload');
