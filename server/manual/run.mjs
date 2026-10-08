/* global console, process, fetch, AbortSignal, setTimeout, URL */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV === 'production') {
  console.error('The local voice harness refuses NODE_ENV=production.');
  process.exit(1);
}
const port = Number(process.env.NULLCHANNEL_MANUAL_PORT ?? 5178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('NULLCHANNEL_MANUAL_PORT must be an integer from 1024 to 65535.');
  process.exit(1);
}
const serverDirectory = fileURLToPath(new URL('../',import.meta.url));
const vitest = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs',import.meta.url));
const shutdownToken = randomUUID();
const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VITE_|SUPABASE_|IMAGEKIT_|TEST_DATABASE_URL$|DATABASE_URL$|CLEANUP_SECRET$)/.test(key)));
const child = spawn(process.execPath,[vitest,'run','--config','manual/vitest.config.ts'],{
  cwd: serverDirectory,detached: true,stdio: ['ignore','inherit','inherit'],env: { ...childEnvironment,NODE_ENV: 'test',NULLCHANNEL_MANUAL_LOCAL: '1',NULLCHANNEL_MANUAL_SHUTDOWN: shutdownToken,NULLCHANNEL_MANUAL_PORT: String(port) }
});
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  const fallback = setTimeout(() => child.kill('SIGTERM'),5000); fallback.unref();
  try {
    await fetch(`http://127.0.0.1:${port}/__manual/stop`,{ method: 'POST',headers: { Origin: `http://127.0.0.1:${port}`,'X-Manual-Shutdown': shutdownToken },signal: AbortSignal.timeout(3000) });
  } catch { child.kill('SIGTERM'); }
};
process.on('SIGINT',stop); process.on('SIGTERM',stop);
child.on('error',error => { console.error(`Unable to launch local harness: ${error.message}`); process.exitCode = 1; });
child.on('exit',(code,signal) => { process.exitCode = stopping && signal ? 0 : code ?? 1; });
