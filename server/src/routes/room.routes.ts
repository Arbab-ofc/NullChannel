import { Router } from 'express';
import { createRoomLimiter, roomLookupLimiter } from '../middlewares/rateLimit.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  burnReadMessageController,
  createRoomController,
  deleteMessageController,
  editMessageController,
  extendRoomController,
  getMessagesController,
  getMyRoomsController,
  getRoomController,
  leaveRoomController,
  participantsController,
  pinMessageController,
  reactToMessageController,
  terminateRoomController,
  wipeRoomController
} from '../controllers/room.controller.js';

const router = Router();
router.post('/rooms', createRoomLimiter, asyncHandler(createRoomController));
router.get('/rooms/:code', roomLookupLimiter, asyncHandler(getRoomController));
router.get('/rooms/:code/messages', roomLookupLimiter, asyncHandler(getMessagesController));
router.patch('/rooms/:code/pin', asyncHandler(pinMessageController));
router.post('/rooms/:code/messages/:messageId/burn-read', asyncHandler(burnReadMessageController));
router.patch('/rooms/:code/messages/:messageId', asyncHandler(editMessageController));
router.post('/rooms/:code/messages/:messageId/reactions', asyncHandler(reactToMessageController));
router.delete('/rooms/:code/messages/:messageId', asyncHandler(deleteMessageController));
router.get('/rooms/:code/participants', roomLookupLimiter, asyncHandler(participantsController));
router.post('/rooms/:code/extend', asyncHandler(extendRoomController));
router.post('/rooms/:code/wipe', asyncHandler(wipeRoomController));
router.post('/rooms/:code/terminate', asyncHandler(terminateRoomController));
router.post('/rooms/:code/leave', asyncHandler(leaveRoomController));
router.get('/users/:senderId/rooms', roomLookupLimiter, asyncHandler(getMyRoomsController));

export default router;
