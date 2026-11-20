const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};

const MODELS = {
  gemini: { provider: 'google', id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  qwen: { provider: 'cloudflare', id: '@cf/qwen/qwen2.5-72b-instruct', label: 'Qwen 2.5 72B' },
  deepseek: { provider: 'cloudflare', id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 Distill Qwen 32B' },
  llama: { provider: 'cloudflare', id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B (سريع وذكي)' }
};
const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 12000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function normalizeReply(result) {
  const text = result?.response ?? result?.result?.response ?? result?.choices?.[0]?.message?.content;
  if (typeof text === 'string') return text.trim();
  if (Array.isArray(text)) return text.map((part) => typeof part === 'string' ? part : part?.text || '').join('').trim();
  return '';
}

async function callGemini(messages, apiKey) {
  if (!apiKey) throw new Error('نموذج Gemini غير مهيأ: تحقق من إضافة GEMINI_API_KEY كـ Secret.');
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts[0].text += `\n\n${message.content}`;
    else contents.push({ role, parts: [{ text: message.content }] });
  }
  if (contents[0]?.role !== 'user') throw new Error('يجب أن تبدأ المحادثة برسالة من المستخدم.');

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `تعذر الاتصال بـ Gemini (HTTP ${response.status}).`);
  return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
}

async function callCloudflare(env, model, messages) {
  if (!env.MY_BINDING || typeof env.MY_BINDING.run !== 'function') {
    throw new Error('ربط Cloudflare Workers AI غير مهيأ. تحقق من ربط MY_BINDING.');
  }
  const result = await env.MY_BINDING.run(model.id, {
    messages: [
      { role: 'system', content: 'أنت مساعد ذكي مفيد يتحدث العربية بطلاقة ووضوح.' },
      ...messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content }))
    ]
  });
  return normalizeReply(result);
}

async function handleChat(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'تعذر قراءة بيانات الطلب بصيغة JSON.' }, 400);
  }

  const modelKey = typeof payload?.model === 'string' ? payload.model : 'gemini';
  const model = MODELS[modelKey];
  if (!model) return json({ error: 'النموذج المختار غير مدعوم.' }, 400);

  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return json({ error: 'سجل المحادثة غير صالح أو طويل جداً.' }, 400);
  }
  for (const message of messages) {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      return json({ error: 'صيغة إحدى رسائل المحادثة غير صالحة.' }, 400);
    }
    message.content = message.content.trim();
    if (!message.content || message.content.length > MAX_MESSAGE_LENGTH) {
      return json({ error: 'إحدى الرسائل فارغة أو تتجاوز الحد المسموح.' }, 400);
    }
  }
  if (messages[0].role !== 'user') return json({ error: 'ابدأ المحادثة برسالة من المستخدم.' }, 400);

  if (modelKey === 'gemini') {
    try {
      const reply = await callGemini(messages, typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '');
      if (reply) return json({ reply, model: modelKey });
      // Treat an empty Gemini response as a provider failure and transparently fall back.
    } catch {
      // Automatically retry this conversation with the configured Cloudflare fallback model.
    }

    const fallbackModel = MODELS.llama;
    try {
      const reply = await callCloudflare(env, fallbackModel, messages);
      if (reply) return json({ reply, model: 'llama', fallbackUsed: true });
      return json({ error: `لم يُرجع ${fallbackModel.label} نصاً. حاول مرة أخرى.` }, 502);
    } catch (error) {
      return json({ error: error?.message || `تعذر إكمال الطلب إلى ${fallbackModel.label}.` }, 502);
    }
  }

  try {
    const reply = await callCloudflare(env, model, messages);
    if (!reply) return json({ error: `لم يُرجع ${model.label} نصاً. حاول مرة أخرى.` }, 502);
    return json({ reply, model: modelKey });
  } catch (error) {
    return json({ error: error?.message || `تعذر إكمال الطلب إلى ${model.label}.` }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      if (request.method !== 'POST') return json({ error: 'يرجى إرسال الطلب بصيغة POST.' }, 405);
      return handleChat(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
