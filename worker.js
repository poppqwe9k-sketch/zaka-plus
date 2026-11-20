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
      try {
        return await onRequestPost({ request, env });
      } catch {
        return json({ error: 'تعذر إكمال طلب المحادثة بسبب خطأ داخلي في Worker. أعد المحاولة أو راجع سجلات Worker.' }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
