import { it, vi } from 'vitest';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const local = vi.hoisted(() => {
  if (process.env.NULLCHANNEL_MANUAL_LOCAL !== '1' || process.env.NODE_ENV !== 'test') throw new Error('Run this isolated fixture only through npm run voice:manual.');
  delete process.env.CLEANUP_SECRET;
  const port = Number(process.env.NULLCHANNEL_MANUAL_PORT ?? 5178);
  const origin = `http://127.0.0.1:${port}`;
  Object.assign(process.env,{ NODE_ENV: 'test',CLIENT_URL: origin,SUPABASE_URL: 'https://manual.invalid',SUPABASE_SERVICE_ROLE_KEY: 'manual-only',IMAGEKIT_PUBLIC_KEY: 'manual-only',IMAGEKIT_PRIVATE_KEY: 'manual-only',IMAGEKIT_URL_ENDPOINT: 'https://manual.invalid',
    CALL_RING_TIMEOUT_MS: '30000',CALL_CONNECT_TIMEOUT_MS: '20000',CALL_DISCONNECT_GRACE_MS: '10000',CALL_MAX_CANDIDATES: '256',CALL_MAX_ACTIVE: '8',CALL_INVITE_LIMIT: '20',CALL_SIGNAL_LIMIT: '300',SOCKET_CONNECTION_LIMIT: '120',SOCKET_JOIN_LIMIT: '30',SOCKET_MESSAGE_LIMIT: '120',SOCKET_TYPING_LIMIT: '180' });
  return { port,origin };
});
vi.mock('../src/config/supabase.js',async () => ({ supabase: (await import('./database.js')).createManualDatabase() }));
vi.mock('../src/config/imagekit.js',() => ({ imagekit: { upload: async () => { throw new Error('ImageKit is disabled in the isolated manual harness.'); },deleteFile: async () => { throw new Error('ImageKit is disabled in the isolated manual harness.'); } } }));
import express from 'express';
import { app } from '../src/app.js';
import { createSocketServer } from '../src/sockets/index.js';
import { getCallRegistry } from '../src/sockets/call.socket.js';
import { requireOrigin } from '../src/middlewares/auth.middleware.js';

it('serves the actual NullChannel application until Ctrl+C',async () => {
  const { createServer: createViteServer } = await import('vite');
  const root = fileURLToPath(new URL('../../client/',import.meta.url));
  const tailwind = (await import('tailwindcss/loadConfig.js')).default(`${root}tailwind.config.ts`);
  let stop!: () => void; const lifetime = new Promise<void>(resolve => { stop = resolve; });
  const fixture = express(); fixture.get('/__manual/health',(_req,res) => res.json({ ready: true,mode: 'local-voice-fixture' }));
  fixture.post('/__manual/stop',requireOrigin,(req,res) => { if (!process.env.NULLCHANNEL_MANUAL_SHUTDOWN || req.get('X-Manual-Shutdown') !== process.env.NULLCHANNEL_MANUAL_SHUTDOWN) { res.sendStatus(403); return; } res.json({ stopped: true }); setTimeout(stop,50); });
  fixture.use('/api/media',(_req,res) => res.status(503).json({ success: false,data: null,error: { code: 'LOCAL_MEDIA_DISABLED',message: 'Media uploads are disabled in this local voice fixture.' } }));
  fixture.use(app);
  const http = createServer(fixture); const io = createSocketServer(http);
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  try {
    await new Promise<void>((resolve,reject) => { http.once('error',reject); http.listen(0,'127.0.0.1',resolve); });
    const address = http.address(); if (!address || typeof address === 'string') throw new Error('No local backend port.');
    const backend = `http://127.0.0.1:${address.port}`;
    vite = await createViteServer({ root,envDir: false,configFile: false,
      define: { 'import.meta.env.VITE_API_URL': '""','import.meta.env.VITE_WEBRTC_STUN_URLS': '""' },
      plugins: [(await import('@vitejs/plugin-react')).default()],
      css: { postcss: { plugins: [(await import('tailwindcss')).default({ ...tailwind,content: [`${root}src/**/*.{ts,tsx}`,`${root}index.html`] }),(await import('autoprefixer')).default()] } },
      server: { host: '127.0.0.1',port: local.port,strictPort: true,cors: { origin: local.origin },allowedHosts: ['127.0.0.1'],
        proxy: { '/api': backend,'/__manual': backend,'/socket.io': { target: backend,ws: true } } }
    });
    await vite.listen();
    console.log(`\nLOCAL VOICE TEST READY: ${local.origin}/chat/TEST1234\nOpen this URL in two separate Chrome profiles (or normal + Incognito).\nEnter Alice and Bob as display names, click Continue, then use the phone button.\nReal microphone/audio enabled; no provider credentials or external STUN used.\nCtrl+C stops the harness and clears its disposable data.\n`);
    await lifetime;
  } finally {
    getCallRegistry(io).dispose();
    await new Promise<void>(resolve => io.close(() => resolve()));
    await vite?.close();
  }
},0);
