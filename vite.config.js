import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Pages serves the generated static SPA; deployment is not part of build.
export default defineConfig({
  appType: 'spa',
  plugins: [react()],
  base: '/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: true
  }
});
