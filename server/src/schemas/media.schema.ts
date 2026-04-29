import { z } from 'zod';

export const mediaBodySchema = z.object({
  roomCode: z.string().trim().length(8).regex(/^[A-Z0-9]+$/),
  type: z.enum(['image', 'voice'])
});
