import { z } from 'zod';

export const mediaBodySchema = z.object({
  roomCode: z.string().trim().length(8).regex(/^[A-Z0-9]+$/),
  senderId: z.string().uuid(),
  type: z.enum(['image', 'voice'])
});
