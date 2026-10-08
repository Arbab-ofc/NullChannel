import type { RequestHandler } from 'express';
import { errorResponse } from '../utils/apiResponse.js';
import { env } from '../config/env.js';
import rateLimit from 'express-rate-limit';

export const rateLimitHandler: RequestHandler = (_req, res) => { res.status(429).json(errorResponse('RATE_LIMITED', 'Too many requests. Please retry shortly.')); };

export const createRoomLimiter = rateLimit({ handler: rateLimitHandler, windowMs: 60 * 60 * 1000, limit: 10 });
export const uploadLimiter = rateLimit({ handler: rateLimitHandler, windowMs: 60 * 60 * 1000, limit: 20 });
export const roomLookupLimiter = rateLimit({ handler: rateLimitHandler, windowMs: 60 * 1000, limit: 60 });

// These run only after session verification; the identity is server-derived.
export const identityMutationLimiter = rateLimit({ handler: rateLimitHandler, windowMs: 60000, limit: env.REST_MUTATION_LIMIT, keyGenerator: (_req, res) => String(res.locals.identity) });
export const identityManagementLimiter = rateLimit({ handler: rateLimitHandler, windowMs: 60000, limit: env.REST_MANAGEMENT_LIMIT, keyGenerator: (_req, res) => String(res.locals.identity) });
