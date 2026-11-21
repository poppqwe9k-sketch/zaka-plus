import { onRequestPost } from './functions/api/chat.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      return onRequestPost({ request, env });
    }
    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
