import { Router } from 'express';
import { env } from '../config/env.js';
import { cleanupExpiredRooms } from '../services/cleanup.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { errorResponse, successResponse } from '../utils/apiResponse.js';

const router = Router();
router.post('/cleanup', asyncHandler(async (req, res) => {
  if (!env.CLEANUP_SECRET || req.headers['x-cleanup-secret'] !== env.CLEANUP_SECRET) {
    res.status(401).json(errorResponse('UNAUTHORIZED', 'Invalid cleanup secret.'));
    return;
  }
  const result = await cleanupExpiredRooms();
  res.json(successResponse(result));
}));

export default router;
