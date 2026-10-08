import { rateLimitHandler } from '../middlewares/rateLimit.middleware.js';
import { Router } from 'express';
import { env } from '../config/env.js';
import { cleanupExpiredRooms } from '../services/cleanup.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { errorResponse, successResponse } from '../utils/apiResponse.js';

import rateLimit from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
const digest = (value: string) => createHash('sha256').update(value).digest();
const router = Router();
router.post('/cleanup', rateLimit({ handler: rateLimitHandler, windowMs: 60000, limit: 10 }), asyncHandler(async (req, res) => {
  if (!env.CLEANUP_SECRET || typeof req.headers['x-cleanup-secret'] !== 'string' || !timingSafeEqual(digest(req.headers['x-cleanup-secret']), digest(env.CLEANUP_SECRET))) {
    res.status(401).json(errorResponse('UNAUTHORIZED', 'Invalid cleanup secret.'));
    return;
  }
  const result = await cleanupExpiredRooms();
  res.json(successResponse(result));
}));

export default router;
