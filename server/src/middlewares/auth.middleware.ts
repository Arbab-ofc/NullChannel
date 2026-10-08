import type { RequestHandler } from 'express';
import { env, isProd } from '../config/env.js';
import { readCookie, verifySession } from '../services/session.service.js';
import { getRoomByCode } from '../services/room.service.js';
import { isActiveMember } from '../services/membership.service.js';
import { errorResponse } from '../utils/apiResponse.js';

export const accessCookie = () => isProd ? '__Host-nc_access' : 'nc_access';
export const refreshCookie = () => isProd ? '__Host-nc_refresh' : 'nc_refresh';
export const requireOrigin: RequestHandler = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== env.CLIENT_URL) {
    res.status(403).json(errorResponse('CSRF_REJECTED', 'A matching Origin header is required.')); return;
  }
  next();
};
export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const session = await verifySession(readCookie(req.headers.cookie, accessCookie()));
    if (!session) { res.status(401).json(errorResponse('SESSION_EXPIRED', 'Renew your anonymous session.')); return; }
    res.locals.identity = session.identity_id;
    // Compatibility fields are overwritten, never used as authentication evidence.
    if (req.body && typeof req.body === 'object') req.body.senderId = session.identity_id;
    if (req.params.senderId) req.params.senderId = session.identity_id;
    next();
  } catch (error) { next(error); }
};
export const requireMembership: RequestHandler = async (req, res, next) => {
  try {
    if (!/^[A-Z0-9]{8}$/i.test(String(req.params.code))) { res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid room code.')); return; }
    if (req.params.messageId && !/^[0-9a-f-]{36}$/i.test(String(req.params.messageId))) { res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid message identifier.')); return; }
    const room = await getRoomByCode(String(req.params.code).toUpperCase());
    if (!room) { res.status(404).json(errorResponse('ROOM_NOT_FOUND', 'Channel not found or expired.')); return; }
    if (!await isActiveMember(room.id, res.locals.identity)) { res.status(403).json(errorResponse('JOIN_REQUIRED', 'Join this channel first.')); return; }
    next();
  } catch (error) { next(error); }
};
