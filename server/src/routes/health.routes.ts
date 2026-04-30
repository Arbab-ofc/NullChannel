import { Router } from 'express';
import { databaseHealthController, healthController } from '../controllers/health.controller.js';

const router = Router();
router.get('/health', healthController);
router.get('/health/db', databaseHealthController);
export default router;
