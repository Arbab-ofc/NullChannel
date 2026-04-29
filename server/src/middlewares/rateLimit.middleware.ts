import rateLimit from 'express-rate-limit';

export const createRoomLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 });
export const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20 });
export const roomLookupLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60 });
