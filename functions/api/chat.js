const MODEL_ID = 'gemini-3.1-flash-lite';
const MODEL_NAME = 'Gemini 3.1 Flash Lite';
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
    messages.push({ role: item.role === 'model' || item.role === 'assistant' ? 'model' : 'user', parts: [{ text: content }] });
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

function extractReply(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim() : '';
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

  const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) return json({ error: 'المساعد غير مهيأ: أضف GEMINI_API_KEY كـ Secret إلى Cloudflare Worker.' }, 503);

  const systemInstruction = typeof body?.systemInstruction === 'string' && body.systemInstruction.trim()
    ? body.systemInstruction.trim().slice(0, 3000)
    : 'أنت مساعد ذكاء بلس | Zaka+. أجب بدقة ووضوح وباللغة التي يطلبها المستخدم.';
  const contents = validation.messages;
  if (attachmentValidation.attachments.length) {
    let lastUserIndex = -1;
    for (let index = contents.length - 1; index >= 0; index -= 1) {
      if (contents[index].role === 'user') { lastUserIndex = index; break; }
    }
    if (lastUserIndex < 0) return json({ error: 'يجب إرفاق الملفات مع رسالة من المستخدم.' }, 400);
    contents[lastUserIndex].parts.push(...attachmentValidation.attachments.map(({ mimeType, data }) => ({ inlineData: { mimeType, data } })));
  }

  const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_ID}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `تعذر طلب Gemini (HTTP ${response.status}).`;
      return json({ error: message, model: MODEL_ID, modelName: MODEL_NAME, status: response.status }, response.status);
    }

    const reply = extractReply(data);
    if (!reply) return json({ error: 'لم يُرجع النموذج إجابة نصية.', model: MODEL_ID, modelName: MODEL_NAME }, 502);
    return json({ reply, model: MODEL_ID, modelName: MODEL_NAME });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return json({
      error: timedOut ? 'انتهت مهلة الاتصال بـ Gemini. أعد المحاولة.' : 'تعذر الاتصال بـ Gemini. تحقق من الاتصال وحاول مجدداً.',
      model: MODEL_ID,
      modelName: MODEL_NAME
    }, timedOut ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestPost({ request, env = {} }) {
  try {
    return await handleChat(request, env);
  } catch {
    return json({ error: 'حدث خطأ داخلي أثناء معالجة المحادثة. أعد المحاولة لاحقاً.' }, 502);
  }
}
