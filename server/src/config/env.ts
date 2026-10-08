import dotenv from 'dotenv';
import { z } from 'zod';

if (process.env.NODE_ENV !== 'test') dotenv.config({ quiet: true });

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5050),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CLIENT_URL: z.string().url().refine(value => new URL(value).origin === value, 'Use an exact origin without a trailing slash.'),
  DATABASE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  IMAGEKIT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  IMAGEKIT_PUBLIC_KEY: z.string().min(1),
  IMAGEKIT_PRIVATE_KEY: z.string().min(1),
  IMAGEKIT_URL_ENDPOINT: z.string().url(),
  SOCKET_CONNECTION_LIMIT: z.coerce.number().int().positive().default(60),
  SOCKET_JOIN_LIMIT: z.coerce.number().int().positive().default(30),
  SOCKET_MESSAGE_LIMIT: z.coerce.number().int().positive().default(120),
  SOCKET_TYPING_LIMIT: z.coerce.number().int().positive().default(180),
  REST_MUTATION_LIMIT: z.coerce.number().int().positive().default(120),
  REST_MANAGEMENT_LIMIT: z.coerce.number().int().positive().default(20),
  UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  CALL_RING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(30000),
  CALL_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  CALL_DISCONNECT_GRACE_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  CALL_INVITE_LIMIT: z.coerce.number().int().min(1).max(30).default(6),
  CALL_SIGNAL_LIMIT: z.coerce.number().int().min(1).max(1000).default(300),
  CALL_MAX_CANDIDATES: z.coerce.number().int().min(16).max(512).default(256),
  CALL_MAX_ACTIVE: z.coerce.number().int().min(1).max(10000).default(1000),
  HOST: z.string().default('127.0.0.1'),
  CLEANUP_SECRET: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'error', operation: 'invalid_environment', fields: [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))] }));
  process.exit(1);
}
export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
