import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The DeepSeek key lives in .env.local (never committed). It is added to the request by this dev / preview server,
// so it is not in the browser code and not in the built site. On a static host there is no such server: the app then asks for your own key.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = {
    '/api/deepseek': {
      target: 'https://api.deepseek.com',
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api\/deepseek/, ''),
      headers: env.DEEPSEEK_API_KEY ? { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` } : undefined,
    },
  };
  return {
    plugins: [react(), tailwindcss()],
    base: './',
    worker: { format: 'es' },
    build: { chunkSizeWarningLimit: 1600 },
    server: { proxy },
    preview: { proxy },
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  };
});
