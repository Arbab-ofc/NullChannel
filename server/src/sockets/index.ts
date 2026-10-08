import { isIP } from 'node:net';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { registerRoomSocket } from './room.socket.js';
import { setSocketServer } from './emitter.js';
import { readCookie, verifySession } from '../services/session.service.js';
import { accessCookie } from '../middlewares/auth.middleware.js';
import { allowEvent } from './rateLimit.js';

const connectionAddress = (req: IncomingMessage) => {
  const peer = req.socket.remoteAddress ?? 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  // The dedicated Nginx location overwrites this header with a single real client IP.
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer) && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
};
export const createSocketServer = (server: HttpServer) => {
  const io = new Server(server, {
    cors: { origin: env.CLIENT_URL, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, callback) => callback(null, req.headers.origin === env.CLIENT_URL && allowEvent(`connect:${connectionAddress(req)}`, env.SOCKET_CONNECTION_LIMIT))
  });

  io.use(async (socket, next) => {
    try {
      const session = await verifySession(readCookie(socket.request.headers.cookie, accessCookie()));
      if (!session) return next(new Error('SESSION_EXPIRED'));
      socket.data.identity = session.identity_id;
      socket.data.sessionId = session.id;
      next();
    } catch { next(new Error('SESSION_UNAVAILABLE')); }
  });

  io.on('connection', (socket) => {
    const sessionWatch = setInterval(async () => {
      try {
        const { supabase } = await import('../config/supabase.js');
        const { data, error } = await supabase.from('anonymous_sessions').select('id').eq('id', socket.data.sessionId).is('revoked_at', null).gt('expires_at', new Date().toISOString()).gt('access_expires_at', new Date().toISOString()).maybeSingle();
        if (error || !data) socket.disconnect(true);
      } catch { socket.disconnect(true); }
    }, 15000);
    sessionWatch.unref();
    socket.once('disconnect', () => clearInterval(sessionWatch));
    socket.emit('connection-status', { connected: true });
    registerRoomSocket(io, socket);
  });

  setSocketServer(io);
  return io;
};
