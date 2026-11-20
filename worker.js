const DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_MODELS = [
  DEFAULT_MODEL,
  'gemini-3.8-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
];
const API_VERSION = 'v1beta';
const REQUEST_TIMEOUT_MS = 45000;
const MAX_MESSAGES = 6;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_MESSAGES).flatMap((message) => {
    if (!message || !['user', 'assistant', 'model'].includes(message.role) || typeof message.content !== 'string') return [];
    const content = message.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) return [];
    return [{ role: message.role === 'model' ? 'model' : message.role, content }];
  });
}

function cleanAttachments(raw) {
  if (!Array.isArray(raw)) return { error: null, attachments: [] };
  if (raw.length > MAX_ATTACHMENTS) return { error: `يمكن إرفاق ${MAX_ATTACHMENTS} ملفات كحد أقصى في الرسالة الواحدة.`, attachments: [] };

  const attachments = [];
  for (const file of raw) {
    if (!file || typeof file.data !== 'string' || typeof file.mimeType !== 'string') {
      return { error: 'بيانات أحد المرفقات غير صالحة. أعد اختيار الملف.', attachments: [] };
    }
    const mimeType = file.mimeType.toLowerCase();
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
      return { error: 'يمكن إرفاق الصور وملفات PDF فقط حالياً.', attachments: [] };
    }
    const encoded = file.data.replace(/^data:[^,]*;base64,/, '');
    if (!encoded || encoded.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3)) {
      return { error: 'حجم المرفق يتجاوز الحد الأقصى (7 ميغابايت).', attachments: [] };
    }
    attachments.push({ mimeType, data: encoded });
  }
  return { error: null, attachments };
}

function toGeminiContents(messages, attachments) {
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts = [{ text: message.content }];
    if (role === 'user' && message === messages[messages.length - 1]) {
      for (const file of attachments) parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
    }
    const previous = contents[contents.length - 1];
    if (previous?.role === role) previous.parts.push(...parts);
    else contents.push({ role, parts });
  }
  return contents;
}

function collectSources(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set();
  return chunks.flatMap((chunk) => {
    const source = chunk?.web;
    if (!source?.uri || seen.has(source.uri)) return [];
    seen.add(source.uri);
    return [{ title: source.title || source.uri, url: source.uri }];
  }).slice(0, 8);
}

async function callGemini({ apiKey, model, messages, attachments, systemInstruction, searchEnabled, thinkingEnabled }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${encodeURIComponent(model)}:generateContent`;
  const instruction = thinkingEnabled
    ? `${systemInstruction}\n\nThink carefully through complex questions internally before answering. Do not reveal private chain-of-thought; provide a concise, well-organized conclusion and key steps.`
    : systemInstruction;
  const payload = {
    contents: toGeminiContents(messages, attachments),
    systemInstruction: { parts: [{ text: instruction }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
  };
  if (searchEnabled) payload.tools = [{ google_search: {} }];

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, model, error: data?.error?.message || `استجابة Gemini غير ناجحة (HTTP ${response.status}).` };

    const parts = data?.candidates?.[0]?.content?.parts;
    const reply = Array.isArray(parts) ? parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim() : '';
    if (!reply) return { ok: false, status: 502, model, error: 'لم يُرجع Gemini إجابة نصية. جرّب صياغة السؤال مجدداً.' };
    return { ok: true, reply, model, sources: searchEnabled ? collectSources(data) : [] };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === 'AbortError' ? 504 : 502,
      model,
      error: error?.name === 'AbortError' ? 'تجاوز الاتصال مهلة الانتظار. أعد المحاولة.' : 'تعذر الاتصال بخدمة Gemini. تحقق من الإنترنت أو حاول لاحقاً.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleChat(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'طريقة الطلب غير مدعومة. استخدم POST.' }, 405);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'تعذر قراءة الطلب؛ يجب أن يكون بصيغة JSON صحيحة.' }, 400); }

  const messages = cleanMessages(body?.messages);
  if (!messages.length) return json({ error: 'اكتب رسالة قبل الإرسال.' }, 400);
  if (messages[0].role !== 'user') return json({ error: 'يجب أن تبدأ المحادثة برسالة من المستخدم.' }, 400);
  const { error: attachmentError, attachments } = cleanAttachments(body?.attachments);
  if (attachmentError) return json({ error: attachmentError }, 400);

  const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) return json({ error: 'المساعد غير مهيأ: أضف GEMINI_API_KEY إلى أسرار Cloudflare Worker.' }, 503);

  const allowedModel = typeof body?.model === 'string' && GEMINI_MODELS.includes(body.model)
    ? body.model
    : DEFAULT_MODEL;
  const candidates = [allowedModel, ...GEMINI_MODELS.filter((model) => model !== allowedModel)];
  const systemInstruction = typeof body?.systemInstruction === 'string' && body.systemInstruction.trim()
    ? body.systemInstruction.trim().slice(0, 2000)
    : 'أنت مساعد ذكاء بلس | Zaka+؛ أجب بوضوح وباللغة التي يطلبها المستخدم. عند وجود بحث، استند إلى مصادر الويب وأشر إليها.';

  for (const model of candidates) {
    const result = await callGemini({
      apiKey,
      model,
      messages,
      attachments,
      systemInstruction,
      searchEnabled: body?.searchEnabled === true,
      thinkingEnabled: body?.thinkingEnabled === true
    });
    if (result.ok) {
      return json({ reply: result.reply, model: result.model, sources: result.sources, fallbackUsed: model !== allowedModel });
    }
    if ([400, 401, 403].includes(result.status)) {
      return json({ error: `تعذر استخدام نموذج Gemini. ${result.error}`, model, status: result.status }, result.status);
    }
  }

  return json({ error: 'تعذر الحصول على إجابة من نماذج Gemini المتاحة. تحقق من مفتاح API أو أعد المحاولة بعد قليل.' }, 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      try { return await handleChat(request, env); }
      catch { return json({ error: 'حدث خطأ غير متوقع أثناء معالجة المحادثة. أعد المحاولة.' }, 502); }
    }
    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
