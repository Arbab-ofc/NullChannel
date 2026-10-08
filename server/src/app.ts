import { rateLimitHandler } from './middlewares/rateLimit.middleware.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from './utils/logger.js';
import healthRoutes from './routes/health.routes.js';
import roomRoutes from './routes/room.routes.js';
import mediaRoutes from './routes/media.routes.js';
import cleanupRoutes from './routes/cleanup.routes.js';
import { applySecurity } from './middlewares/security.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';

import sessionRoutes from './routes/session.routes.js';
import { authenticate, requireOrigin } from './middlewares/auth.middleware.js';
import rateLimit from 'express-rate-limit';

export const app = express();
app.set('trust proxy', 'loopback');
app.use((req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-ID', res.locals.requestId);
  res.once('finish', () => { if (process.env.NODE_ENV === 'production') logger.info('http_request', { requestId: res.locals.requestId, method: req.method, status: res.statusCode }); });
  next();
});
applySecurity(app);
app.use(express.json({ limit: '1mb' }));
app.use('/api', healthRoutes);
app.use('/api', cleanupRoutes);
app.use('/api', requireOrigin);
app.use('/api', sessionRoutes);
app.use('/api', rateLimit({ handler: rateLimitHandler, windowMs: 60000, limit: 300 }));
app.use('/api', authenticate);
app.use('/api', roomRoutes);
app.use('/api', mediaRoutes);

app.use(errorMiddleware);
