import { onRequestPost as onChatPost } from './functions/api/chat.js';
import { onRequestPost as onImagePost } from './functions/api/image.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      return onChatPost({ request, env });
    }
    if (url.pathname === '/api/image') {
      return onImagePost({ request, env });
    }
    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
