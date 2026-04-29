import { Router } from 'express';
import multer from 'multer';
import { uploadLimiter } from '../middlewares/rateLimit.middleware.js';
import { uploadMediaController } from '../controllers/media.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.post('/media/upload', uploadLimiter, upload.single('file'), asyncHandler(uploadMediaController));

export default router;
