import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['manual/voice.manual.ts'],testTimeout: 0,maxWorkers: 1,disableConsoleIntercept: true } });
