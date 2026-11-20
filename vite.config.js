import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA build for Cloudflare Pages. Deployment is handled by Pages,
// not by a wrangler deploy command in the build lifecycle.
export default defineConfig({
  plugins: [react()],
  base: '/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
