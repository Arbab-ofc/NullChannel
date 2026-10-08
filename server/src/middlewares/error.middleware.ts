import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { logger } from '../utils/logger.js';
export const errorMiddleware = (err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  const oversized = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
  const status = oversized || err.status === 413 ? 413 : err instanceof multer.MulterError || err.status === 400 ? 400 : 500;
  logger.error('request_failed', { status, errorType: err.name, errorCode: err.code && /^[A-Z0-9_]{1,40}$/.test(err.code) ? err.code : undefined, requestId: res.locals.requestId });
  res.status(status).json({ success: false, data: null, error: { code: status === 413 ? 'UPLOAD_TOO_LARGE' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message: status === 413 ? 'Upload exceeds the 15 MiB limit.' : status === 400 ? 'Invalid request.' : 'Internal server error.' } });
};
