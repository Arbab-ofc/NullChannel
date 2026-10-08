import { rateLimitHandler } from '../middlewares/rateLimit.middleware.js';
import { revokeSessionSockets } from '../sockets/emitter.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { accessCookie, refreshCookie } from '../middlewares/auth.middleware.js';
import { readCookie, renewSession, ACCESS_MS, SESSION_MS, hashToken } from '../services/session.service.js';
import { isProd } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse } from '../utils/apiResponse.js';
const router = Router();
router.post('/session', rateLimit({ handler: rateLimitHandler, windowMs: 60000, limit: 30 }), asyncHandler(async (req, res) => {
  const session = await renewSession(readCookie(req.headers.cookie, refreshCookie()), readCookie(req.headers.cookie, accessCookie()));
  const options = { httpOnly: true, secure: isProd, sameSite: 'strict' as const, path: '/' };
  res.cookie(accessCookie(), session.access, { ...options, maxAge: ACCESS_MS });
  res.cookie(refreshCookie(), session.refresh, { ...options, maxAge: Math.min(SESSION_MS, Date.parse(session.expires_at) - Date.now()) });
  res.setHeader('Cache-Control', 'no-store');
  res.json(successResponse({ identityId: session.identity_id, expiresAt: session.expires_at }));
}));
router.delete('/session', asyncHandler(async (req, res) => {
  const token = readCookie(req.headers.cookie, refreshCookie());
  if (token) {
    const { data, error } = await supabase.from('anonymous_sessions').update({ revoked_at: new Date().toISOString() }).eq('refresh_hash', hashToken(token)).select('id');
    if (error) throw error;
    for (const session of data ?? []) await revokeSessionSockets(session.id);
  }
  res.clearCookie(accessCookie(), { path: '/', secure: isProd, httpOnly: true, sameSite: 'strict' });
  res.clearCookie(refreshCookie(), { path: '/', secure: isProd, httpOnly: true, sameSite: 'strict' });
  res.json(successResponse({ revoked: true }));
}));
export default router;
