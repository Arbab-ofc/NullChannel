import type { Request, Response } from 'express';
import { supabase } from '../config/supabase.js';
import { successResponse } from '../utils/apiResponse.js';

export const healthController = (_req: Request, res: Response) => {
  res.json(successResponse({
    status: 'ok',
    service: 'nullchannel-server',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  }));
};

export const databaseHealthController = async (_req: Request, res: Response) => {
  const { error } = await supabase.from('rooms').select('id').limit(1);

  if (error) {
    res.status(503).json(successResponse({
      status: 'degraded',
      database: 'down',
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  res.json(successResponse({
    status: 'ok',
    database: 'connected',
    timestamp: new Date().toISOString()
  }));
};
