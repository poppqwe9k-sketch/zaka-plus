export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'يرجى إرسال الطلب بصيغة POST.' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      try {
        const response = await env.AI_CHAT?.fetch
          ? await env.AI_CHAT.fetch(request)
          : null;
        if (response) return response;

        const { onRequestPost } = await import('./functions/api/chat.js');
        return await onRequestPost({ request, env });
      } catch (error) {
        return new Response(JSON.stringify({
          error: 'تعذر إكمال طلب المحادثة بسبب خطأ داخلي في Worker.'
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
