import { onRequestPost as onChatPost } from './functions/api/chat.js';
import { onRequestPost as onImagePost } from './functions/api/image.js';
import { onRequestGet as onQuotaGet } from './functions/api/quota.js';
import { onRequestPost as onTtsPost } from './functions/api/tts.js';
import { onRequestPost as onTranscribePost } from './functions/api/transcribe.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      return onChatPost({ request, env });
    }
    if (url.pathname === '/api/image') {
      return onImagePost({ request, env });
    }
    if (url.pathname === '/api/quota') {
      return onQuotaGet({ request, env });
    }
    if (url.pathname === '/api/tts') {
      return onTtsPost({ request, env });
    }
    if (url.pathname === '/api/transcribe') {
      return onTranscribePost({ request, env });
    }
    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
