import { Router } from 'express';
import multer from 'multer';
import { uploadLimiter } from '../middlewares/rateLimit.middleware.js';
import { uploadMediaController } from '../controllers/media.controller.js';

import { LIMITS } from '../constants/limits.js';
import { uploadCapacity } from '../middlewares/upload.middleware.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.FILE_MAX_BYTES, files: 1, fields: 3, fieldSize: 256, parts: 4, fieldNameSize: 64 } });
const router = Router();

router.post('/media/upload', uploadLimiter, uploadCapacity, (req, res, next) => {
  const release = res.locals.releaseUpload as () => void;
  upload.single('file')(req, res, error => {
    if (error) { release(); next(error); return; }
    if (req.aborted) { release(); return; }
    res.locals.uploadProcessing = true;
    void uploadMediaController(req, res).catch(next).finally(release);
  });
});

export default router;
