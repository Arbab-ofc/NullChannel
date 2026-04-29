import type { Request, Response } from 'express';
import { successResponse } from '../utils/apiResponse.js';

export const healthController = (_req: Request, res: Response) => {
  res.json(successResponse({ status: 'ok', service: 'nullchannel-server' }));
};
