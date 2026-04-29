import { z } from 'zod';

const senderId = z.string().uuid();

export const socketMessageSchema = z.object({
  roomCode: z.string().trim().length(8).regex(/^[A-Z0-9]+$/),
  senderId,
  type: z.enum(['text', 'image', 'voice']),
  content: z.string().trim().max(2000).optional(),
  fileUrl: z.string().url().optional(),
  filePath: z.string().optional()
}).refine((v) => (v.type === 'text' ? !!v.content : !!v.fileUrl), 'Invalid message payload');
