/**
 * @file vite.config.js
 * @description Vite build config with dev-server proxy to avoid CORS during development
 * @author SwingTrader AI Team
 * @created 2026-06-13
 * @lastModified 2026-06-13
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': { target: 'http://localhost:5001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5001', ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
