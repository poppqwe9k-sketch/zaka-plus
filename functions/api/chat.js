const GEMINI_MODEL_ID = 'gemini-3.1-flash-lite';
const GEMINI_MODEL_NAME = 'بلس برو';
const CLOUDFLARE_MODEL_ID = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEEPSEEK_MODEL_ID = 'deepseek-ai/DeepSeek-V4-Pro';
const API_VERSION = 'v1beta';
const MAX_MESSAGES = 10;
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
    messages.push({ role: item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user', content });
  }
  if (messages[0].role !== 'user') return { error: 'يجب أن تبدأ المحادثة برسالة من المستخدم.' };
  return { messages };
}

function validateAttachments(value) {
  if (value === undefined) return { attachments: [] };
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return { error: `يمكن إرفاق ${MAX_ATTACHMENTS} ملفات كحد أقصى.` };
  const attachments = [];
  for (const item of value) {
    if (!item || typeof item.data !== 'string' || typeof item.mimeType !== 'string') return { error: 'بيانات أحد المرفقات غير صالحة.' };
    const match = item.data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || match[1].toLowerCase() !== item.mimeType.toLowerCase()) return { error: 'تعذر قراءة أحد المرفقات. أعد اختياره.' };
    const mimeType = item.mimeType.toLowerCase();
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') return { error: 'الملفات المرفقة المدعومة هي الصور وPDF.' };
    if (match[2].length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3)) return { error: 'حجم المرفق يتجاوز الحد الأقصى وهو 7 ميغابايت.' };
    attachments.push({ mimeType, data: match[2] });
  }
  return { attachments };
}

function extractGeminiReply(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim() : '';
}

function extractWorkersAIReply(result) {
  if (typeof result === 'string') return result.trim();
  if (typeof result?.response === 'string') return result.response.trim();
  const choice = result?.choices?.[0]?.message?.content;
  if (typeof choice === 'string') return choice.trim();
  if (Array.isArray(choice)) return choice.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim();
  return '';
}

async function runWorkersAI(env, messages, systemInstruction) {
  const conversation = systemInstruction ? [{ role: 'system', content: systemInstruction }, ...messages] : messages;
  const result = await env.AI.run(CLOUDFLARE_MODEL_ID, { messages: conversation });
  const reply = extractWorkersAIReply(result);
  if (!reply) throw new Error('Workers AI returned an empty response.');
  return reply;
}

async function runGemini(env, messages, attachments, systemInstruction) {
  const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) throw new Error('أضف GEMINI_API_KEY أو فعّل ربط Cloudflare Workers AI (AI) للمساعد.');
  const contents = messages.map(({ role, content }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text: content }] }));
  if (attachments.length) {
    let lastUserIndex = -1;
    for (let index = contents.length - 1; index >= 0; index -= 1) {
      if (contents[index].role === 'user') { lastUserIndex = index; break; }
    }
    if (lastUserIndex < 0) throw new Error('يجب إرفاق الملفات مع رسالة من المستخدم.');
    contents[lastUserIndex].parts.push(...attachments.map(({ mimeType, data }) => ({ inlineData: { mimeType, data } })));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/${API_VERSION}/models/${GEMINI_MODEL_ID}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemInstruction }] }, generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `تعذر طلب Gemini (HTTP ${response.status}).`);
    const reply = extractGeminiReply(data);
    if (!reply) throw new Error('لم يُرجع Gemini إجابة نصية.');
    return reply;
  } finally {
    clearTimeout(timer);
  }
}

async function runDeepSeekV4Pro(env, messages, systemInstruction) {
  const hfToken = typeof env?.HF_TOKEN === 'string' ? env.HF_TOKEN.trim() : '';
  if (!hfToken) throw new Error('HF_TOKEN غير موجود في متغيرات Cloudflare.');
  const conversation = systemInstruction ? [{ role: 'system', content: systemInstruction }, ...messages] : messages;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DEEPSEEK_MODEL_ID, messages: conversation, stream: false }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `خطأ من DeepSeek (HTTP ${response.status}).`);
    const reply = typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content.trim() : '';
    if (!reply) throw new Error('لم يُرجع DeepSeek-V4-Pro إجابة نصية.');
    return reply;
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

  const validation = validateMessages(body?.messages);
  if (validation.error) return json({ error: validation.error }, 400);
  const attachmentValidation = validateAttachments(body?.attachments);
  if (attachmentValidation.error) return json({ error: attachmentValidation.error }, 400);
  const systemInstruction = typeof body?.systemInstruction === 'string' && body.systemInstruction.trim()
    ? body.systemInstruction.trim().slice(0, 3000)
    : 'أنت مساعد ذكاء بلس | Zaka+. أجب بدقة ووضوح وباللغة التي يطلبها المستخدم.';
  const attachments = attachmentValidation.attachments;
  const selectedModel = body?.selectedModel === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'gemini-3.8-flash';

  if (selectedModel === 'deepseek-v4-pro') {
    try {
      const reply = await runDeepSeekV4Pro(env, validation.messages, systemInstruction);
      return json({ reply, model: DEEPSEEK_MODEL_ID, modelName: 'DeepSeek-V4-Pro' });
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      return json({ error: timedOut ? 'انتهت مهلة الاتصال بـ DeepSeek-V4-Pro. أعد المحاولة.' : (error instanceof Error ? error.message : 'تعذر الاتصال بـ DeepSeek-V4-Pro.') }, timedOut ? 504 : 502);
    }
  }

  const forceGemini = body?.provider === 'gemini' || attachments.length > 0;
  const hasWorkersAI = typeof env?.AI?.run === 'function';
  const hasGemini = typeof env?.GEMINI_API_KEY === 'string' && env.GEMINI_API_KEY.trim();

  if (forceGemini && !hasGemini) return json({ error: 'المرفقات تتطلب إعداد GEMINI_API_KEY.' }, 503);
  if (!hasWorkersAI && !hasGemini) return json({ error: 'لم يتم تهيئة مزود ذكاء اصطناعي. فعّل ربط Workers AI (AI) أو أضف GEMINI_API_KEY.' }, 503);

  if (!forceGemini && hasWorkersAI) {
    try {
      const reply = await runWorkersAI(env, validation.messages, systemInstruction);
      return json({ reply, model: CLOUDFLARE_MODEL_ID, modelName: 'Cloudflare Workers AI' });
    } catch (error) {
      if (!hasGemini) return json({ error: error instanceof Error ? error.message : 'تعذر الاتصال بـ Workers AI.' }, 502);
    }
  }

  try {
    const reply = await runGemini(env, validation.messages, attachments, systemInstruction);
    return json({ reply, model: GEMINI_MODEL_ID, modelName: GEMINI_MODEL_NAME });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return json({
      error: timedOut ? 'انتهت مهلة الاتصال بـ Gemini. أعد المحاولة.' : (error instanceof Error ? error.message : 'تعذر الاتصال بمزود الذكاء الاصطناعي.'),
      model: GEMINI_MODEL_ID,
      modelName: GEMINI_MODEL_NAME
    }, timedOut ? 504 : 502);
  }
}

export async function onRequestPost({ request, env = {} }) {
  try {
    return await handleChat(request, env);
  } catch {
    return json({ error: 'حدث خطأ داخلي أثناء معالجة المحادثة. أعد المحاولة لاحقاً.' }, 502);
  }
}

