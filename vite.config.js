import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), admin: resolve(import.meta.dirname, 'admin/index.html') } }
  },
  /* `npm run dev:api` serves the API locally; the Host header is kept so its same-origin check sees this dev server */
  server: { port: 5173, host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  test: { include: ['tests/**/*.test.mjs'] }
});
