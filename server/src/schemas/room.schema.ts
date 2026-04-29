import { z } from 'zod';

export const roomCodeSchema = z.object({
  code: z.string().trim().length(8).regex(/^[A-Z0-9]+$/)
});

export const createRoomSchema = z.object({
  senderId: z.string().uuid(),
  roomType: z.enum(['private', 'group']).default('private')
});

export const terminateRoomSchema = z.object({
  senderId: z.string().uuid()
});

export const senderParamSchema = z.object({
  senderId: z.string().uuid()
});
