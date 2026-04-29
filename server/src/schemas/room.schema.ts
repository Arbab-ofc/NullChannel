import { z } from 'zod';

export const roomCodeSchema = z.object({
  code: z.string().trim().length(8).regex(/^[A-Z0-9]+$/)
});
