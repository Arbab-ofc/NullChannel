import { createServer } from 'node:http';
import cron from 'node-cron';
import { app } from './app.js';
import { createSocketServer } from './sockets/index.js';
import { env } from './config/env.js';
import { cleanupExpiredRooms } from './services/cleanup.service.js';

const httpServer = createServer(app);
createSocketServer(httpServer);

cron.schedule('*/15 * * * *', async () => {
  await cleanupExpiredRooms();
});

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${env.PORT} is already in use. Update server/.env PORT and retry.`);
    process.exit(1);
  }
  throw error;
});

httpServer.listen(env.PORT, () => {
  console.log(`Server running on ${env.PORT}`);
});
