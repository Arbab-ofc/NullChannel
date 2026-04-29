import { Router } from 'express';
import { createRoomLimiter, roomLookupLimiter } from '../middlewares/rateLimit.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createRoomController, getMessagesController, getRoomController } from '../controllers/room.controller.js';

const router = Router();
router.post('/rooms', createRoomLimiter, asyncHandler(createRoomController));
router.get('/rooms/:code', roomLookupLimiter, asyncHandler(getRoomController));
router.get('/rooms/:code/messages', roomLookupLimiter, asyncHandler(getMessagesController));

export default router;
