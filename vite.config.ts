import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1600 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
