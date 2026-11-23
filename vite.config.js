import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build a static single-page app for Cloudflare Pages. Hosting performs the
// deployment; this config intentionally contains no Wrangler deploy command.
export default defineConfig({
  appType: 'spa',
  plugins: [react()],
  base: '/',
  publicDir: 'public',
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: true
  }
});
