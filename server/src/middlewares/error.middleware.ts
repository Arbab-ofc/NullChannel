import type { NextFunction, Request, Response } from 'express';

export const errorMiddleware = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({
    success: false,
    data: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    }
  });
};
