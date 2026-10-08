import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { errorResponse } from '../utils/apiResponse.js';
let active = 0;
export const uploadCapacity: RequestHandler = (_req, res, next) => {
  if (active >= env.UPLOAD_CONCURRENCY) {
    res.setHeader('Retry-After', '5'); res.status(503).json(errorResponse('UPLOAD_BUSY', 'Upload capacity reached. Please retry.')); return;
  }
  active += 1;
  let released = false;
  const release = () => { if (!released) { active -= 1; released = true; } };
  res.locals.releaseUpload = release;
  _req.once('aborted', () => { if (!res.locals.uploadProcessing) release(); });
  next();
};
