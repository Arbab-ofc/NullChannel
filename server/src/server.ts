import { createServer } from 'node:http';
import cron from 'node-cron';
import { app } from './app.js';
import { createSocketServer } from './sockets/index.js';
import { env } from './config/env.js';
import { cleanupExpiredRooms } from './services/cleanup.service.js';
import { logger } from './utils/logger.js';
import { supabase } from './config/supabase.js';
const httpServer = createServer(app);
const io = createSocketServer(httpServer);
let cleanupTask: Promise<unknown> | undefined;
const runCleanup = () => {
  if (cleanupTask) return;
  cleanupTask = cleanupExpiredRooms().catch(() => logger.error('cleanup_failed')).finally(() => { cleanupTask = undefined; });
};
const job = cron.schedule('* * * * *', runCleanup);
httpServer.on('error', (error: Error & { code?: string }) => {
  logger.error('startup_failed', { code: error.code }); process.exit(1);
});
httpServer.listen(env.PORT, env.HOST, () => { logger.info('server_started', { port: env.PORT }); runCleanup(); });
let shuttingDown = false;
const shutdown = async (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started');
  const deadline = setTimeout(() => process.exit(1), 25000); deadline.unref();
  await job.stop();
  await new Promise<void>(resolve => io.close(() => resolve()));
  if (httpServer.listening) await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await cleanupTask;
  await supabase.removeAllChannels();
  clearTimeout(deadline);
  logger.info('shutdown_complete');
  process.exit(exitCode);
};
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
process.on('unhandledRejection', () => { logger.error('unhandled_rejection'); void shutdown(1); });
process.on('uncaughtException', () => { logger.error('uncaught_exception'); process.exit(1); });
