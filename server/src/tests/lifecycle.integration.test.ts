import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const testEnv = {
  PATH: process.env.PATH,
  NODE_ENV: 'test', HOST: '127.0.0.1', CLIENT_URL: 'http://localhost:5173',
  SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-key',
  IMAGEKIT_PUBLIC_KEY: 'test-public', IMAGEKIT_PRIVATE_KEY: 'test-only-private-key', IMAGEKIT_URL_ENDPOINT: 'http://127.0.0.1:9'
};
const availablePort = async () => {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test listener');
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
};
const start = (port: string) => {
  const child = spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('../server.ts', import.meta.url))],{ env: { ...testEnv, PORT: port }, stdio: ['ignore','pipe','pipe'] });
  let logs = '';
  child.stdout.on('data',chunk => { logs += chunk.toString(); }); child.stderr.on('data',chunk => { logs += chunk.toString(); });
  const exit = new Promise<number | null>(resolve => child.once('exit',resolve));
  const ready = new Promise<void>((resolve,reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Test server startup timed out')); },7000);
    child.stdout.on('data',chunk => { if (chunk.toString().includes('server_started')) { clearTimeout(timer); resolve(); } });
    child.once('exit',code => { clearTimeout(timer); reject(new Error(`Test server exited before ready: ${code}`)); });
  });
  // A failed startup is deliberately asserted through exit/logs in one test.
  void ready.catch(() => undefined);
  return { child, ready, exit, logs: () => logs };
};
describe('real backend startup and shutdown with disposable configuration', () => {
  it.each(['SIGTERM','SIGINT'] as const)('closes HTTP/Socket.IO and exits cleanly on %s', async signal => {
    const port = await availablePort(); const server = start(String(port));
    try {
      await server.ready;
      const live = await fetch(`http://127.0.0.1:${port}/api/health`); expect(live.status).toBe(200);
      const readiness = await fetch(`http://127.0.0.1:${port}/api/health/db`); expect(readiness.status).toBe(503);
      expect(await readiness.text()).not.toContain('test-only-service-key');
      server.child.kill(signal); expect(await server.exit).toBe(0);
      expect(server.logs()).toContain('shutdown_complete'); expect(server.logs()).not.toContain('test-only-private-key');
    } finally { if (server.child.exitCode === null) server.child.kill('SIGKILL'); }
  },10000);
  it('reports invalid startup configuration without leaking supplied credentials', async () => {
    const server = start('invalid'); expect(await server.exit).toBe(1);
    expect(server.logs()).toContain('invalid_environment'); expect(server.logs()).not.toContain('test-only-service-key');
  },10000);
});
