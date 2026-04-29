import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Express } from 'express';
import { env, isProd } from '../config/env.js';

export const applySecurity = (app: Express) => {
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: false }));
  if (!isProd) app.use(morgan('dev'));
};
