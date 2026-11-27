import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost as onChatPost } from './functions/api/chat.js';
import { onRequestPost as onImagePost } from './functions/api/image.js';
import { onRequestGet as onQuotaGet } from './functions/api/quota.js';
import { onRequestPost as onTtsPost } from './functions/api/tts.js';
import { onRequestPost as onTranscribePost } from './functions/api/transcribe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.use(express.json({ limit: '40mb' }));
app.use(['/sw.js', '/service-worker.js'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

let devFileEnv = {};

function getServerEnv() {
  return { ...devFileEnv, ...process.env };
}

function mountFunctionHandler(routePath, handler) {
  app.all(routePath, async (req, res) => {
    try {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers.host || `127.0.0.1:${PORT}`;
      const url = new URL(req.originalUrl, `${protocol}://${host}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        const lower = key.toLowerCase();
        if (lower === 'content-length' || lower === 'transfer-encoding' || lower === 'host') continue;
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }

      const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      const webRequest = new Request(url.toString(), {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body ?? {}) : undefined
      });

      const webResponse = await handler({ request: webRequest, env: getServerEnv() });
      res.status(webResponse.status);
      webResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const payload = Buffer.from(await webResponse.arrayBuffer());
      res.send(payload);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : 'حدث خطأ داخلي في الخادم.'
      });
    }
  });
}

mountFunctionHandler('/api/chat', onChatPost);
mountFunctionHandler('/api/image', onImagePost);
mountFunctionHandler('/api/quota', onQuotaGet);
mountFunctionHandler('/api/tts', onTtsPost);
mountFunctionHandler('/api/transcribe', onTranscribePost);

if (isProduction) {
  const distDir = path.resolve(__dirname, 'dist');
  app.use(express.static(distDir));
  app.use((_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  const { createServer: createViteServer, loadEnv } = await import('vite');
  devFileEnv = loadEnv('development', __dirname, '');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Plus AI server listening on http://0.0.0.0:${PORT}`);
});
