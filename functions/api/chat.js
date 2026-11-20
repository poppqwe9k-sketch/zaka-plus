const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = [
  DEFAULT_MODEL,
  'gemini-3.8-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite'
];
const API_VERSION = 'v1beta';
const MAX_MESSAGES = 6;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 14000;
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

function validateMessages(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: 'أرسل رسالة واحدة على الأقل.' };
  if (value.length > MAX_MESSAGES) return { error: `يسمح بإرسال آخر ${MAX_MESSAGES} رسائل فقط.` };

  const messages = [];
  for (const item of value) {
    if (!item || !['user', 'assistant', 'model'].includes(item.role) || typeof item.content !== 'string') {
      return { error: 'صيغة إحدى رسائل المحادثة غير صالحة.' };
    }
    const content = item.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) return { error: 'إحدى الرسائل فارغة أو تتجاوز الحد المسموح.' };
    messages.push({ role: item.role === 'model' ? 'model' : item.role, content });
  }
  if (messages[0].role !== 'user') return { error: 'يجب أن تبدأ المحادثة برسالة من المستخدم.' };
  return { messages };
}

function validateAttachments(value) {
  if (value === undefined) return { attachments: [] };
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    return { error: `يمكن إرفاق ${MAX_ATTACHMENTS} ملفات كحد أقصى.` };
  }

  const attachments = [];
  for (const item of value) {
    if (!item || typeof item.data !== 'string' || typeof item.mimeType !== 'string') {
      return { error: 'بيانات أحد المرفقات غير صالحة. أعد اختيار الملف.' };
    }
    const match = item.data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || match[1].toLowerCase() !== item.mimeType.toLowerCase()) {
      return { error: 'تعذر قراءة أحد المرفقات. أعد اختيار الصورة أو ملف PDF.' };
    }
    const mimeType = item.mimeType.toLowerCase();
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
      return { error: 'الملفات المدعومة حالياً هي الصور وPDF فقط.' };
    }
    if (match[2].length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3)) {
      return { error: 'حجم المرفق يتجاوز الحد الأقصى وهو 7 ميغابايت.' };
    }
    attachments.push({ mimeType, data: match[2] });
  }
  return { attachments };
}

function toGeminiContents(messages, attachments) {
  const contents = [];
  messages.forEach((message, index) => {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts = [{ text: message.content }];
    if (index === messages.length - 1 && role === 'user') {
      attachments.forEach((attachment) => parts.push({ inlineData: attachment }));
    }
    const previous = contents[contents.length - 1];
    if (previous?.role === role) previous.parts.push(...parts);
    else contents.push({ role, parts });
  });
  return contents;
}

function extractSources(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set();
  return chunks.flatMap((chunk) => {
    const web = chunk?.web;
    if (!web?.uri || seen.has(web.uri)) return [];
    seen.add(web.uri);
    return [{ title: web.title || web.uri, url: web.uri }];
  }).slice(0, 8);
}

function extractReply(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim()
    : '';
}

async function callGemini({ apiKey, model, messages, attachments, systemInstruction, searchEnabled, thinkingEnabled }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${encodeURIComponent(model)}:generateContent`;
  const systemText = thinkingEnabled
    ? `${systemInstruction}\n\nThink through complex problems carefully before answering. Do not reveal private chain-of-thought; provide a concise, accurate, well-structured answer with key steps.`
    : systemInstruction;
  const payload = {
    contents: toGeminiContents(messages, attachments),
    systemInstruction: { parts: [{ text: systemText }] },
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
    if (!response.ok) {
      return { ok: false, status: response.status, model, message: data?.error?.message || `تعذر طلب Gemini (HTTP ${response.status}).` };
    }
    const reply = extractReply(data);
    if (!reply) return { ok: false, status: 502, model, message: 'لم يُرجع Gemini إجابة نصية.' };
    return { ok: true, reply, model, sources: searchEnabled ? extractSources(data) : [] };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      model,
      message: timedOut ? 'انتهت مهلة الاتصال بـ Gemini. أعد المحاولة.' : 'تعذر الاتصال بـ Gemini. تحقق من الإنترنت أو حاول لاحقاً.'
    };
  } finally {
    clearTimeout(timer);
  }
}

async function handleChat(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'يرجى استخدام POST لإرسال الرسائل.' }, 405);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'تعذر قراءة الطلب؛ يجب أن يكون JSON صالحاً.' }, 400); }

  const messageResult = validateMessages(body?.messages);
  if (messageResult.error) return json({ error: messageResult.error }, 400);
  const attachmentResult = validateAttachments(body?.attachments);
  if (attachmentResult.error) return json({ error: attachmentResult.error }, 400);

  const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) return json({ error: 'المساعد غير مهيأ: أضف GEMINI_API_KEY كـ Secret إلى Cloudflare Worker.' }, 503);

  const requestedModel = typeof body?.model === 'string' ? body.model.trim() : '';
  const selectedModel = FALLBACK_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_MODEL;
  const models = [selectedModel, ...FALLBACK_MODELS.filter((model) => model !== selectedModel)];
  const instruction = typeof body?.systemInstruction === 'string' && body.systemInstruction.trim()
    ? body.systemInstruction.trim().slice(0, 2000)
    : 'أنت مساعد ذكاء بلس | Zaka+. أجب بدقة ووضوح وباللغة التي يطلبها المستخدم.';

  let lastResult;
  for (const model of models) {
    const result = await callGemini({
      apiKey,
      model,
      messages: messageResult.messages,
      attachments: attachmentResult.attachments,
      systemInstruction: instruction,
      searchEnabled: body?.searchEnabled === true,
      thinkingEnabled: body?.thinkingEnabled === true
    });
    if (result.ok) {
      return json({ reply: result.reply, model: result.model, sources: result.sources, fallbackUsed: model !== selectedModel });
    }
    lastResult = result;
    if ([400, 401, 403].includes(result.status)) break;
  }

  const status = lastResult?.status >= 400 && lastResult.status < 600 ? lastResult.status : 502;
  return json({
    error: lastResult?.message || 'تعذر الحصول على إجابة من نماذج Gemini المتاحة. حاول مجدداً.',
    model: lastResult?.model || selectedModel,
    status
  }, status);
}

export async function onRequestPost({ request, env = {} }) {
  try {
    return await handleChat(request, env);
  } catch {
    return json({ error: 'حدث خطأ داخلي أثناء معالجة المحادثة. أعد المحاولة لاحقاً.' }, 502);
  }
}
