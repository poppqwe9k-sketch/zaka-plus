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
const GEMINI_FALLBACK_MODEL = 'gemini-3.8-flash-lite';
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

function toGeminiContents(messages) {
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts[0].text += `\n\n${message.content}`;
    else contents.push({ role, parts: [{ text: message.content }] });
  }
  return contents;
}

async function callGemini(messages, apiKey, modelId) {
  if (!apiKey) return { ok: false, status: 503, error: 'خدمة Gemini غير مهيأة حالياً.' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: toGeminiContents(messages), generationConfig: { temperature: 0.7 } })
    });
  } catch {
    return { ok: false, status: 0, error: 'تعذر الاتصال بخدمة Gemini.' };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, status: response.status, error: data?.error?.message || `تعذر الاتصال بخدمة Gemini (HTTP ${response.status}).` };
  }
  const reply = data?.candidates?.[0]?.content?.parts?.map((part) => typeof part.text === 'string' ? part.text : '').join('').trim();
  return reply
    ? { ok: true, reply, model: modelId }
    : { ok: false, status: 502, error: 'لم يُرجع Gemini نصاً صالحاً.' };
}

async function callWorkersAI(env, model, messages) {
  const binding = env?.MY_BINDING || env?.AI;
  if (!binding || typeof binding.run !== 'function') return null;
  const result = await binding.run(model.id, {
    messages: [
      { role: 'system', content: 'أنت مساعد ذكي مفيد يتحدث العربية بطلاقة ووضوح.' },
      ...messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content }))
    ]
  });
  const reply = normalizeReply(result);
  return reply ? { reply, model: model.id } : null;
}

async function answerWithGemini(env, messages) {
  const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  const primary = await callGemini(messages, apiKey, MODELS.gemini.id);
  if (primary.ok) return json({ reply: primary.reply, model: 'gemini' });

  let geminiResult = primary;
  if (primary.status === 503 || primary.status === 404) {
    geminiResult = await callGemini(messages, apiKey, GEMINI_FALLBACK_MODEL);
    if (geminiResult.ok) return json({ reply: geminiResult.reply, model: 'gemini', fallbackUsed: true });
  }

  // Workers AI is an optional last-resort fallback. Missing binding must not
  // replace the useful Gemini error with an internal binding-name message.
  try {
    const fallback = await callWorkersAI(env, MODELS.llama, messages);
    if (fallback) return json({ reply: fallback.reply, model: 'llama', fallbackUsed: true });
  } catch {
    // Return the Gemini provider error below if the optional fallback is unavailable.
  }
  return json({ error: geminiResult.error || 'تعذر إكمال الطلب إلى Gemini.' }, 502);
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
  const cleanMessages = [];
  for (const message of messages) {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      return json({ error: 'صيغة إحدى رسائل المحادثة غير صالحة.' }, 400);
    }
    const content = message.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) {
      return json({ error: 'إحدى الرسائل فارغة أو تتجاوز الحد المسموح.' }, 400);
    }
    cleanMessages.push({ role: message.role, content });
  }
  if (cleanMessages[0].role !== 'user') return json({ error: 'ابدأ المحادثة برسالة من المستخدم.' }, 400);

  if (modelKey === 'gemini') return answerWithGemini(env, cleanMessages);

  try {
    const result = await callWorkersAI(env, model, cleanMessages);
    if (!result) return json({ error: 'النموذج المحدد غير متاح حالياً.' }, 503);
    return json({ reply: result.reply, model: modelKey });
  } catch {
    return json({ error: 'تعذر إكمال الطلب إلى النموذج المحدد. حاول مرة أخرى.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      if (request.method !== 'POST') return json({ error: 'يرجى إرسال الطلب بصيغة POST.' }, 405);
      try {
        return await handleChat(request, env);
      } catch {
        return json({ error: 'حدث خطأ داخلي أثناء معالجة الطلب.' }, 502);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
