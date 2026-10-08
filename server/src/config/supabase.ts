import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: (input, init) => fetch(input, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(env.DATABASE_TIMEOUT_MS)]) : AbortSignal.timeout(env.DATABASE_TIMEOUT_MS)
  }) }
});
