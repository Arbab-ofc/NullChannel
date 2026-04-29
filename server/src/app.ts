import express from 'express';
import healthRoutes from './routes/health.routes.js';
import roomRoutes from './routes/room.routes.js';
import mediaRoutes from './routes/media.routes.js';
import cleanupRoutes from './routes/cleanup.routes.js';
import { applySecurity } from './middlewares/security.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';

export const app = express();
applySecurity(app);
app.use(express.json({ limit: '1mb' }));
app.use('/api', healthRoutes);
app.use('/api', roomRoutes);
app.use('/api', mediaRoutes);
app.use('/api', cleanupRoutes);
app.use(errorMiddleware);
