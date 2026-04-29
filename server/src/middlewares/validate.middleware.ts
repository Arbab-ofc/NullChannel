import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

export const validate = <T>(schema: ZodSchema<T>) => (req: Request, res: Response, next: NextFunction) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request' } });
    return;
  }
  req.body = parsed.data;
  next();
};
