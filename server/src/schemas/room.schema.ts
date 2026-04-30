import { z } from 'zod';

export const roomCodeSchema = z.object({
  code: z.string().trim().length(8).regex(/^[A-Z0-9]+$/)
});

export const createRoomSchema = z.object({
  senderId: z.string().uuid(),
  senderName: z.string().trim().min(2).max(24),
  roomType: z.enum(['private', 'group']).default('private'),
  roomName: z.string().trim().min(2).max(40),
  expiresInMinutes: z.union([z.literal(15), z.literal(60), z.literal(360), z.literal(1440)]).default(1440)
});

export const terminateRoomSchema = z.object({
  senderId: z.string().uuid()
});

export const senderParamSchema = z.object({
  senderId: z.string().uuid()
});
