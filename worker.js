import { onRequestPost } from './functions/api/chat.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return json({ error: 'طريقة الطلب غير مدعومة.' }, 405);
      }
      return onRequestPost({ request, env });
    }

    // Wrangler serves files from dist through the static-assets binding.
    // SPA fallback is configured in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  }
};
